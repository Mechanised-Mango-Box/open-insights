import { describe, expect, it } from 'vitest';
import { ANALYSIS_FEATURE_COLUMNS } from '../analysis/stats';
import { featuresFor, resolveSelection, unusableReason } from './model-selection.service';
import {
  ModelCard,
  ModelEntry,
  ModelList,
  modelsUrl,
  recommendationUrl,
} from './recommendation.service';

const entry = (id: string, features: string[], compatible = true): ModelEntry => ({
  id,
  source: 'builtin',
  default: id === 'full',
  card: { id, features } as unknown as ModelCard,
  compatible,
  problems: compatible ? [] : ['Trained with scikit-learn 0.1.0'],
});

const list: ModelList = {
  default: 'full',
  models: [
    entry('full', [...ANALYSIS_FEATURE_COLUMNS]),
    entry('video', ['duration', 'scene_change_rate', 'text_density']),
    entry('broken', ['duration'], false),
  ],
};

describe('resolveSelection', () => {
  it('keeps a stored choice the server still has', () => {
    expect(resolveSelection(list, 'video')?.id).toBe('video');
  });

  it("falls back to the server's default for a choice it no longer has or cannot run", () => {
    expect(resolveSelection(list, 'gone')?.id).toBe('full');
    expect(resolveSelection(list, 'broken')?.id).toBe('full');
    expect(resolveSelection(list, null)?.id).toBe('full');
  });

  it('is nothing until the list has loaded', () => {
    expect(resolveSelection(null, 'video')).toBeNull();
  });

  it('falls back to a usable model when the default is missing or broken', () => {
    expect(resolveSelection({ ...list, default: 'missing' }, null)?.id).toBe('full');
    const brokenDefault: ModelList = {
      ...list,
      models: [entry('full', ['duration'], false), ...list.models.slice(1)],
    };
    expect(resolveSelection(brokenDefault, null)?.id).toBe('video');
  });

  it('is nothing when no model can be used', () => {
    const none: ModelList = { default: 'full', models: [entry('broken', ['duration'], false)] };
    expect(resolveSelection(none, 'broken')).toBeNull();
  });
});

describe('unusableReason', () => {
  it('is null while any model can be used', () => {
    expect(unusableReason(list)).toBeNull();
    expect(unusableReason(null)).toBeNull();
  });

  it("names each model's problem and a default the server does not list", () => {
    const stale: ModelList = {
      default: 'full',
      models: [
        {
          ...entry('audio', [], false),
          card: null,
          problems: ['model.json is missing or unreadable.'],
        },
      ],
    };
    const reason = unusableReason(stale)!;
    expect(reason).toContain('audio: model.json is missing or unreadable.');
    expect(reason).toContain("default model, 'full', is not among them");
  });
});

describe('featuresFor', () => {
  it("is the model's own features, in its order", () => {
    expect(featuresFor(list.models[1])).toEqual(['duration', 'scene_change_rate', 'text_density']);
  });

  it('drops a feature this client cannot compute rather than sending a guess', () => {
    expect(featuresFor(entry('odd', ['duration', 'heart_rate']))).toEqual(['duration']);
  });

  it('is every feature for a server that predates model selection', () => {
    expect(featuresFor(null)).toEqual([...ANALYSIS_FEATURE_COLUMNS]);
  });
});

describe('model urls', () => {
  it('names the model in the query, escaped, and leaves it off for the default', () => {
    expect(recommendationUrl('http://localhost:5000', 'abc', 'my model')).toBe(
      'http://localhost:5000/api/videos/abc/recommendation?model=my%20model',
    );
    expect(recommendationUrl('http://localhost:5000', 'abc')).toBe(
      'http://localhost:5000/api/videos/abc/recommendation',
    );
    expect(modelsUrl('https://example.test')).toBe('https://example.test/api/models');
  });
});
