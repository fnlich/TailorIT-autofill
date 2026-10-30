import '../../shared/zod-setup';
import { createCapturePagePlatform } from '../../platform/chrome';
import { captureTabOf, runCapture } from '../../ui/capture/capture';
import { adoptPageStyles } from '../../ui/page/styles';

// Development builds only: the snapshot hotkeys open this page, with ?tabId=N, beside the tab they save.
adoptPageStyles(document);
void runCapture({
  root: document.getElementById('root')!,
  tabId: captureTabOf(location.search),
  platform: createCapturePagePlatform(),
  urls: URL,
  now: () => new Date(),
});
