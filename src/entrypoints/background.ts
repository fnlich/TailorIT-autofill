import '../shared/zod-setup';
import { defineBackground } from 'wxt/utils/define-background';
import { startWorker } from '../background';

export default defineBackground(() => {
  startWorker();
});
