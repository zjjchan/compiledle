import { useEffect, useMemo, useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'compiledle_install_banner_dismissed';

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [installed, setInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone)
    );
  });
  const [showIosGuide, setShowIosGuide] = useState(false);

  const isIosSafari = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIOS && isSafari;
  }, []);

  useEffect(() => {
    if (installed) return;

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [installed]);

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore storage errors
    }
  }

  async function handleNativeInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    } else {
      handleDismiss();
    }
    setDeferredPrompt(null);
  }

  if (installed || dismissed) return null;
  if (!deferredPrompt && !isIosSafari) return null;

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="rounded-2xl border border-amber-300/70 bg-amber-50/90 dark:border-amber-400/30 dark:bg-amber-400/10 px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={deferredPrompt ? () => void handleNativeInstall() : () => setShowIosGuide(true)}
            className="flex items-center gap-3 text-left min-w-0 flex-1 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              {deferredPrompt ? (
                <Download className="w-4 h-4 text-amber-700 dark:text-amber-300" />
              ) : (
                <Smartphone className="w-4 h-4 text-amber-700 dark:text-amber-300" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-950 dark:text-amber-100">
                Install Compiledle as an App
              </p>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-200/80 truncate">
                {deferredPrompt
                  ? 'Add to your home screen for quick launch and push reminders.'
                  : 'Tap here for quick steps to add Compiledle to your Home Screen.'}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={
                deferredPrompt ? () => void handleNativeInstall() : () => setShowIosGuide(true)
              }
              className="rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-3 py-1.5 text-xs transition cursor-pointer"
            >
              {deferredPrompt ? 'Install' : 'How to Install'}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss install banner"
              className="p-1.5 rounded-lg text-amber-700/70 hover:text-amber-950 hover:bg-amber-200/60 dark:text-amber-300/70 dark:hover:text-amber-100 dark:hover:bg-amber-400/15 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 dark:bg-black/75 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xl pb-safe">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Install Compiledle on iOS Safari
              </h3>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ol className="space-y-3.5 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-amber-400/20 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center shrink-0">
                  1
                </span>
                <p className="pt-0.5">
                  Tap the{' '}
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
                    <Share className="w-3.5 h-3.5 inline" /> Share
                  </span>{' '}
                  button in Safari&apos;s toolbar.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-amber-400/20 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center shrink-0">
                  2
                </span>
                <p className="pt-0.5">
                  Scroll down and tap{' '}
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-white">
                    <PlusSquare className="w-3.5 h-3.5 inline" /> Add to Home Screen
                  </span>
                  .
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-amber-400/20 text-amber-700 dark:text-amber-300 font-bold flex items-center justify-center shrink-0">
                  3
                </span>
                <p className="pt-0.5">
                  Tap <strong className="text-slate-900 dark:text-white">Add</strong> in the
                  top-right corner, then open Compiledle from your Home Screen to enjoy full-screen
                  mode and push notifications.
                </p>
              </li>
            </ol>

            <div className="flex justify-end pt-5 mt-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                className="rounded-xl bg-amber-400 hover:bg-amber-500 dark:hover:bg-amber-300 text-slate-950 font-semibold px-4 py-2 text-xs transition cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
