// test/speech.test.ts: Unit Tests for Web Speech API Audio Guide
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { speechManager } from '../web/src/lib/speech.svelte';

describe('SpeechManager', () => {
  let spokenUtterances: any[] = [];
  let cancelCalled = false;

  beforeEach(() => {
    spokenUtterances = [];
    cancelCalled = false;

    class MockSpeechSynthesisUtterance {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      voice = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    const mockSpeechSynthesis = {
      speak: vi.fn((utterance: any) => {
        spokenUtterances.push(utterance);
        utterance.onstart?.();
      }),
      cancel: vi.fn(() => {
        cancelCalled = true;
      }),
      getVoices: vi.fn(() => [
        { lang: 'ja-JP', name: 'Kyoko' },
        { lang: 'en-US', name: 'Samantha' },
      ]),
    };

    (globalThis as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    (globalThis as any).speechSynthesis = mockSpeechSynthesis;
    (globalThis as any).window = {
      speechSynthesis: mockSpeechSynthesis,
      SpeechSynthesisUtterance: MockSpeechSynthesisUtterance,
    };

    speechManager.isSupported = true;
    speechManager.stop();
  });

  it('correctly formats and speaks post details in Standard Japanese', () => {
    const post = {
      id: 'post_1',
      title: '中央避難所',
      area: '中央区本町',
      status_label: '開設中・受入可能',
      note: '毛布と温かい食事があります',
    };

    speechManager.speakPost(post, 'ja');

    expect(speechManager.isSpeaking).toBe(true);
    expect(speechManager.activePostId).toBe('post_1');
    expect(spokenUtterances.length).toBe(1);
    expect(spokenUtterances[0].lang).toBe('ja-JP');
    expect(spokenUtterances[0].text).toContain('中央避難所');
    expect(spokenUtterances[0].text).toContain('地域、中央区本町');
    expect(spokenUtterances[0].text).toContain('現在の状況、開設中・受入可能');
    expect(spokenUtterances[0].text).toContain(
      '備考、毛布と温かい食事があります'
    );
  });

  it('correctly formats and speaks post details in Easy Japanese', () => {
    const post = {
      id: 'post_2',
      title: 'きゅうすいじょ',
      area: 'ほんちょう',
      status_label: 'あいている',
      note: 'ボトルをもってきてください',
    };

    speechManager.speakPost(post, 'ja-easy');

    expect(spokenUtterances.length).toBe(1);
    expect(spokenUtterances[0].lang).toBe('ja-JP');
    expect(spokenUtterances[0].text).toContain('ばしょ、ほんちょう');
    expect(spokenUtterances[0].text).toContain('いまの ようす、あいている');
    expect(spokenUtterances[0].text).toContain(
      'おしらせ、ボトルをもってきてください'
    );
  });

  it('correctly formats and speaks post details in English', () => {
    const post = {
      id: 'post_3',
      title: 'Water Supply Station',
      area: 'North District',
      status_label: 'Open',
      note: 'Bring clean containers',
    };

    speechManager.speakPost(post, 'en');

    expect(spokenUtterances.length).toBe(1);
    expect(spokenUtterances[0].lang).toBe('en-US');
    expect(spokenUtterances[0].text).toContain(
      'Water Supply Station. Location: North District. Status: Open.'
    );
    expect(spokenUtterances[0].text).toContain('Note: Bring clean containers');
  });

  it('toggles playback off when the same post is requested again', () => {
    const post = {
      id: 'post_toggle',
      title: '避難所テスト',
      area: '東区',
      status_label: '満員',
    };

    // First call -> starts speaking
    speechManager.speakPost(post, 'ja');
    expect(speechManager.isSpeaking).toBe(true);
    expect(speechManager.activePostId).toBe('post_toggle');

    // Second call with same post -> stops
    speechManager.speakPost(post, 'ja');
    expect(speechManager.isSpeaking).toBe(false);
    expect(speechManager.activePostId).toBe(null);
    expect(cancelCalled).toBe(true);
  });
});
