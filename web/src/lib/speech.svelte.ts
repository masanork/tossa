// web/src/lib/speech.svelte.ts: Web Speech API (Text-to-Speech) for Accessibility & Disaster Audio Guide

interface SpeechPostData {
  id: string;
  title: string;
  area: string;
  status_label: string;
  note?: string | null;
}

class SpeechManager {
  isSpeaking = $state(false);
  activePostId = $state<string | null>(null);
  isSupported = $state(false);

  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.isSupported = true;
    }
  }

  speakPost(post: SpeechPostData, currentLang: string = 'ja') {
    if (!this.isSupported) return;

    // Toggle: if already speaking this post, stop
    if (this.isSpeaking && this.activePostId === post.id) {
      this.stop();
      return;
    }

    this.stop();

    // Prepare text based on language
    let textToSpeak: string;
    const isEn = currentLang === 'en';
    const isEasy = currentLang === 'ja-easy';

    if (isEn) {
      textToSpeak = `${post.title}. Location: ${post.area}. Status: ${post.status_label}.`;
      if (post.note) {
        textToSpeak += ` Note: ${post.note}`;
      }
    } else if (isEasy) {
      textToSpeak = `${post.title}。ばしょ、${post.area}。いまの ようす、${post.status_label}。`;
      if (post.note) {
        textToSpeak += ` おしらせ、${post.note}`;
      }
    } else {
      textToSpeak = `${post.title}。地域、${post.area}。現在の状況、${post.status_label}。`;
      if (post.note) {
        textToSpeak += ` 備考、${post.note}`;
      }
    }

    try {
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      this.currentUtterance = utterance;

      const targetLang = isEn ? 'en-US' : 'ja-JP';
      utterance.lang = targetLang;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select matching voice if available
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice = voices.find((v) =>
        v.lang.startsWith(isEn ? 'en' : 'ja')
      );
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.activePostId = post.id;
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.activePostId = null;
        this.currentUtterance = null;
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.activePostId = null;
        this.currentUtterance = null;
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error('Speech synthesis failed:', e);
      this.stop();
    }
  }

  stop() {
    if (!this.isSupported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    this.isSpeaking = false;
    this.activePostId = null;
    this.currentUtterance = null;
  }
}

export const speechManager = new SpeechManager();
