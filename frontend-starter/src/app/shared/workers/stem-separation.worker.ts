import { StemSeparationRequest, StemWorkerMessage } from '../models/stem-separation.model';
import { runSeparation } from './stem-separation-runner';
import { createStemSeparationStrategy } from './stem-separation-strategies';

self.onmessage = ({ data }: MessageEvent<StemSeparationRequest>) =>
  runSeparation(
    data,
    createStemSeparationStrategy,
    (message: StemWorkerMessage, transfer?: Transferable[]) =>
      postMessage(message, { transfer: transfer ?? [] }),
  );
