/** Browser speech-to-text for vanilla PWA add form — no startup cost until mic clicked. */

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript?: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  return new Ctor();
}

export function initVoiceInput(
  inputId: string,
  buttonParentId?: string,
): { supported: boolean } {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (!input) return { supported: false };

  const recognition = getRecognition();
  if (!recognition) return { supported: false };

  const parent = buttonParentId
    ? document.getElementById(buttonParentId)
    : input.parentElement;
  if (!parent) return { supported: false };

  if (parent.querySelector("[data-voice-mic]")) return { supported: true };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.voiceMic = "1";
  btn.className = "voice-mic-btn";
  btn.title = "Voice input";
  btn.textContent = "🎤";
  btn.setAttribute("aria-label", "Voice input");

  const status = document.createElement("span");
  status.className = "voice-status muted";
  status.hidden = true;

  let listening = false;

  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-IN";

  recognition.onresult = (ev) => {
    const t = ev.results[0]?.[0]?.transcript?.trim();
    if (t) {
      input.value = input.value.trim() ? `${input.value.trim()} ${t}` : t;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    listening = false;
    btn.textContent = "🎤";
    status.hidden = true;
  };

  recognition.onerror = () => {
    listening = false;
    btn.textContent = "🎤";
    status.textContent = "Voice unavailable";
    status.hidden = false;
    setTimeout(() => { status.hidden = true; }, 3000);
  };

  recognition.onend = () => {
    listening = false;
    btn.textContent = "🎤";
    status.hidden = true;
  };

  btn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }
    try {
      listening = true;
      btn.textContent = "■";
      status.textContent = "Listening…";
      status.hidden = false;
      recognition.start();
    } catch {
      listening = false;
      status.textContent = "Mic blocked";
      status.hidden = false;
    }
  });

  parent.appendChild(btn);
  parent.appendChild(status);
  return { supported: true };
}
