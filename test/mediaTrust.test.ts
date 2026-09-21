import { describe, it, expect } from 'vitest';
import {
  hammingDistance,
  assessAiGenerationRisk,
  detectContradictions,
} from '../web/src/lib/mediaTrust';
import type { ImageRecord } from '../web/src/lib/mediaTrust';

describe('mediaTrust', () => {
  describe('hammingDistance', () => {
    it('returns 0 for identical hashes', () => {
      expect(hammingDistance('aabbccdd11223344', 'aabbccdd11223344')).toBe(0);
    });

    it('counts differing bits', () => {
      // 0x00 vs 0x01 differs by 1 bit
      expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
      // 0x00 vs 0xff differs by 8 bits in one nibble, 0 in the rest -> 4
      expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
    });

    it('returns max distance for malformed hashes', () => {
      expect(hammingDistance('short', 'aabbccdd11223344')).toBe(64);
    });
  });

  describe('assessAiGenerationRisk', () => {
    it('marks C2PA images as low risk', () => {
      expect(assessAiGenerationRisk(true, false, 0)).toBe('low');
    });

    it('marks images without C2PA or EXIF as high risk', () => {
      expect(assessAiGenerationRisk(false, false, 70)).toBe('high');
    });

    it('marks moderate edit score without provenance as medium risk', () => {
      expect(assessAiGenerationRisk(false, false, 40)).toBe('medium');
    });

    it('marks clean metadata as low risk', () => {
      expect(assessAiGenerationRisk(false, true, 10)).toBe('low');
    });
  });

  describe('detectContradictions', () => {
    it('detects different timestamps for similar images', () => {
      const record: ImageRecord = {
        id: 'a',
        dataUrl: '',
        pHash: 'hash',
        takenAt: '2026-09-20T10:00:00Z',
        lat: 35.0,
        lng: 139.0,
      };
      const similar: ImageRecord[] = [
        {
          id: 'b',
          dataUrl: '',
          pHash: 'hash',
          takenAt: '2025-01-01T00:00:00Z',
          lat: 35.0,
          lng: 139.0,
        },
      ];
      const warnings = detectContradictions(record, similar);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('撮影日時');
    });

    it('detects different locations for similar images', () => {
      const record: ImageRecord = {
        id: 'a',
        dataUrl: '',
        pHash: 'hash',
        takenAt: '2026-09-20T10:00:00Z',
        lat: 35.0,
        lng: 139.0,
      };
      const similar: ImageRecord[] = [
        {
          id: 'b',
          dataUrl: '',
          pHash: 'hash',
          takenAt: '2026-09-20T10:00:00Z',
          lat: 36.0,
          lng: 140.0,
        },
      ];
      const warnings = detectContradictions(record, similar);
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain('位置');
    });

    it('ignores the record itself', () => {
      const record: ImageRecord = {
        id: 'a',
        dataUrl: '',
        pHash: 'hash',
        takenAt: '2026-09-20T10:00:00Z',
      };
      const warnings = detectContradictions(record, [record]);
      expect(warnings.length).toBe(0);
    });
  });
});
