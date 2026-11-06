// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_HOSTS, modelHosts, pickModelHost, probeUrl } from '../src/core/transcribe/model-hosts';

const SITE = 'https://lectern.example.com/assets/transcribe.worker-abc.js';
const config = () => new Response('{"model_type":"whisper"}', { status: 200, headers: { 'content-type': 'application/json' } });

describe('speech model hosts', () => {
  it('uses Hugging Face, then this site’s /hf/ forward, by default', () => {
    expect(DEFAULT_MODEL_HOSTS).toEqual(['https://huggingface.co/', '/hf/']);
    expect(modelHosts(undefined, SITE)).toEqual(['https://huggingface.co/', 'https://lectern.example.com/hf/']);
    expect(modelHosts('  ', SITE)).toEqual(['https://huggingface.co/', 'https://lectern.example.com/hf/']);
  });

  it('leaves paths out when there is no site address to read them against', () => {
    expect(modelHosts(undefined)).toEqual(['https://huggingface.co/']);
    expect(modelHosts('/hf/')).toEqual(['https://huggingface.co/']);
  });

  it('reads the setting: https or a path, trailing slash added, no repeats', () => {
    expect(modelHosts('/hf, https://huggingface.co, http://plain.example, //evil.example/, https://huggingface.co/, nonsense', SITE))
      .toEqual(['https://lectern.example.com/hf/', 'https://huggingface.co/']);
    expect(modelHosts('https://models.example.com/hf', SITE)).toEqual(['https://models.example.com/hf/']);
  });

  it('probes the same path transformers.js downloads from', () => {
    expect(probeUrl('https://lectern.example.com/hf/', 'onnx-community/whisper-base'))
      .toBe('https://lectern.example.com/hf/onnx-community/whisper-base/resolve/main/config.json');
  });

  it('picks the first host that answers with a config', async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      if (url.startsWith('https://huggingface.co/')) throw new TypeError('Failed to fetch');
      return config();
    }) as unknown as typeof fetch;
    const hosts = modelHosts(undefined, SITE);
    await expect(pickModelHost(hosts, 'onnx-community/whisper-base', fetcher)).resolves.toBe('https://lectern.example.com/hf/');
    expect(asked).toHaveLength(2);
  });

  it('skips a site that answers /hf/ with its own page', async () => {
    const fetcher = (async (url: string) => {
      if (url.startsWith('https://huggingface.co/')) throw new TypeError('Failed to fetch');
      return new Response('<!doctype html><title>Lectern</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    await expect(pickModelHost(modelHosts(undefined, SITE), 'm', fetcher)).resolves.toBe('https://huggingface.co/');
  });

  it('skips a host that answers with an error, and falls back to the first when none works', async () => {
    const notFound = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(pickModelHost(modelHosts(undefined, SITE), 'm', notFound)).resolves.toBe('https://huggingface.co/');
  });

  it('gives up on a host that hangs', async () => {
    const fetcher = ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      if (url.includes('/hf/')) return resolve(config());
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
    })) as unknown as typeof fetch;
    await expect(pickModelHost(modelHosts(undefined, SITE), 'm', fetcher, 50)).resolves.toBe('https://lectern.example.com/hf/');
  });

  it('asks nobody when there is only one host', async () => {
    const fetcher = (() => { throw new Error('should not be called'); }) as unknown as typeof fetch;
    await expect(pickModelHost(['https://lectern.example.com/hf/'], 'm', fetcher)).resolves.toBe('https://lectern.example.com/hf/');
  });
});
