import { useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';

interface FaqPageProps {
  onBack: () => void;
}

interface FaqEntry {
  id: string;
  question: string;
  answer: ReactNode;
}

const FAQ_ITEMS: FaqEntry[] = [
  {
    id: 'what-is-compiledle',
    question: 'What is Compiledle?',
    answer: (
      <p>
        Compiledle is a website for you to compile and keep track of all your daily games, like Wordle, NYT Connections,
        Krillion, and more. Add any daily game by URL, drag to organize your list in the order you
        like to play, track which games you&apos;ve finished today, and get scheduled push
        reminders so you never miss a streak.
      </p>
    ),
  },
  {
    id: 'install-pwa',
    question: 'How to install the website as a Progressive Web App (PWA) on my phone?',
    answer: (
      <div className="space-y-2.5">
        <p>Installing Compiledle adds it to your Home Screen and enables full-screen mode and push alerts:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>iPhone / iPad (Safari):</strong> Tap the <strong>Share</strong> button in the
            toolbar, scroll down and tap <strong>Add to Home Screen</strong>, then tap{' '}
            <strong>Add</strong>.
          </li>
          <li>
            <strong>iPhone / iPad (Chrome):</strong> Tap the <strong>Share</strong> icon in the
            address bar, choose <strong>Add to Home Screen</strong>, and tap <strong>Add</strong>.
          </li>
          <li>
            <strong>Android (Chrome):</strong> Tap the <strong>Install</strong> banner at the top of
            the page, or open the browser menu (<strong>⋮</strong>) and tap{' '}
            <strong>Install app</strong> / <strong>Add to Home screen</strong>.
          </li>
          <li>
            <strong>Android (Samsung Internet):</strong> Tap the menu icon (<strong>≡</strong>) →{' '}
            <strong>Add page to</strong> → <strong>Home screen</strong>.
          </li>
          <li>
            <strong>Android (Firefox):</strong> Tap the menu icon (<strong>⋮</strong>) →{' '}
            <strong>Install</strong> (or <strong>Add to Home screen</strong>).
          </li>
          <li>
            <strong>Android / Desktop (Microsoft Edge):</strong> Open the menu (<strong>⋯</strong>)
            → <strong>Apps</strong> → <strong>Install this site as an app</strong>.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'notification-delay',
    question: 'Why do my notifications sometimes appear later than set?',
    answer: (
      <div className="space-y-2">
        <p>
          Compiledle checks for due reminders every <strong>15 minutes</strong> (at :00, :15, :30,
          and :45). Depending on network latency and your phone&apos;s battery-saving features (such
          as Android Doze mode or iOS Background App Refresh throttling), push delivery can
          occasionally arrive a few minutes after the scheduled time.
        </p>
        <p>
          If alerts arrive at the wrong hour altogether, open <strong>Notification Settings</strong>{' '}
          and confirm your <strong>Local Timezone</strong> is up to date. If alerts stop arriving,
          click <strong>Re-register Device</strong> in Notification Settings.
        </p>
      </div>
    ),
  },
  {
    id: 'catalog-source',
    question: 'Where is the list of selectable dailies from?',
    answer: (
      <p>
        Many of the daily games in Compiledle&apos;s catalog are sourced from{' '}
        <a
          href="https://dles.aukspot.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-amber-600 hover:underline dark:text-amber-400"
        >
          aukspot&apos;s Dles (dles.aukspot.com)
        </a>
        , alongside other games suggested by the community and curated for Compiledle.
      </p>
    ),
  },
  {
    id: 'suggest-dailies',
    question: "How do I suggest dailies that aren't in the list?",
    answer: (
      <div className="space-y-2">
        <p>
          Open the <strong>Add Daily</strong> modal and click{' '}
          <strong>Can&apos;t find a game? Request it</strong> at the bottom (or tap the request
          button when your search has no matches). Enter the game&apos;s website URL along with an
          optional display name and category to submit it for review.
        </p>
        <p>
          Each user can request a given game once, and requests are reviewed in order of
          popularity. Please note that submitted games are reviewed before being added and may not
          always be accepted (for example, if a link is not a daily game or is unavailable).
        </p>
      </div>
    ),
  },
  {
    id: 'about-developer',
    question: 'About the developer',
    answer: (
      <div className="space-y-2">
        <p>
          I'm a Singaporean Information Systems graduate that has too many daily games to keep track of. 
          My favourites are probably Minute Cryptic and Krillion.
        </p>
        <p>
          Full disclosure: Compiledle was made using AI (Specifically, Google Gemini). 
          I was simply looking for a way to easily track all my dailies, 
          and had a bit of spare time on my hands.
        </p>
      </div>
    ),
  },
];

export function FaqPage({ onBack }: FaqPageProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  function toggleItem(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 pb-16 space-y-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white mb-2 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dailies
        </button>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
          Frequently Asked Questions
        </h2>
      </div>

      <div className="space-y-3">
        {FAQ_ITEMS.map((item) => {
          const isOpen = openIds.has(item.id);
          return (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                aria-expanded={isOpen}
                className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              >
                <span className="text-base font-semibold text-slate-900 dark:text-white">
                  {item.question}
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {isOpen && (
                <div className="px-5 pb-5 pt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800/80">
                  {item.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
