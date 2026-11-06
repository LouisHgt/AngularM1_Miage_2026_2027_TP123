import {
  SeparationAudio,
  StemResult,
  StemSeparationRequest,
  StemSeparationStrategy,
  StemWorkerMessage,
} from '../models/stem-separation.model';

/**
 * Orchestration d'une séparation dans le Worker. Isolée de `self.onmessage` pour
 * pouvoir être testée avec une stratégie simulée et un `post` espion.
 * Toute erreur est signalée explicitement par un message `error` (aucun repli silencieux).
 */
export async function runSeparation(
  data: StemSeparationRequest,
  createStrategy: (mode: StemSeparationRequest['mode']) => StemSeparationStrategy,
  post: (message: StemWorkerMessage, transfer?: Transferable[]) => void,
): Promise<void> {
  const report = (progress: number, message: string): void =>
    post({ type: 'progress', progress, message });

  try {
    const strategy = createStrategy(data.mode);
    report(5, `Chargement du modèle ${strategy.label.toLowerCase()}…`);
    await strategy.loadModels();
    report(20, `Modèle chargé. ${strategy.getTensorSummary()}`);
    report(22, 'Vérification d’une inférence ONNX…');
    report(25, await strategy.validateModelContract());

    const audio: SeparationAudio = {
      sampleRate: data.sampleRate,
      channels: data.channels,
    };
    // La progression 30 → 95 % est émise par la stratégie pendant le traitement par blocs.
    const stems: ReadonlyArray<StemResult> = await strategy.separate(audio, report);
    report(97, 'Transfert des quatre stems…');
    post(
      { type: 'complete', stems: [...stems] },
      stems.flatMap((stem) => stem.channels.map((channel) => channel.buffer as ArrayBuffer)),
    );
  } catch (error) {
    console.error('[StemSeparation] Échec dans le Worker', error);
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'La séparation IA a échoué.',
    });
  }
}
