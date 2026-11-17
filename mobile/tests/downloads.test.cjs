const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const queueKey = '@mobil_media_toolkit_download_queue_v1';
const historyKey = '@mobil_media_toolkit_local_downloads';
const options = { url: 'https://youtu.be/abcdefghijk', type: 'm4a', quality: 'high', title: 'Parça' };
const completed = { fileName: 'track.m4a', filePath: '/downloads/track.m4a', fileSize: '2 MB' };

function loadModule(relativePath, dependencies) {
  const code = babel.transformSync(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    }, console: { ...console, error: () => {}, warn: () => {} }, URL, setTimeout, clearTimeout,
  });
  return exports;
}

const identity = loadModule('src/services/downloadIdentity.js', {});
function setup({ store = new Map(), native = {}, setItem } = {}) {
  const calls = [];
  const removed = [];
  const bridge = {
    downloadResumable: async (...args) => { calls.push(args); return completed; },
    mediaFileExists: async () => true,
    discardDownload: async (id) => { removed.push(id); },
    isWifiConnected: async () => true,
    ...native,
  };
  const api = loadModule('src/services/api.js', {
    './downloadIdentity': identity,
    'react-native': { Platform: { OS: 'android' }, NativeModules: { YoutubeDLNative: bridge }, DeviceEventEmitter: { addListener() {} }, PermissionsAndroid: {} },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => store.get(key) || null,
      setItem: setItem || (async (key, value) => { store.set(key, value); }),
    },
    'expo-file-system/legacy': {}, 'expo-sharing': {},
  });
  return { api, store, calls, removed };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('State did not settle');
}

test('YouTube URL variants identify the same video; lookalike hosts are rejected', () => {
  for (const url of ['abcdefghijk', 'https://youtu.be/abcdefghijk?t=20', 'https://www.youtube.com/watch?v=abcdefghijk&list=PL123', 'https://m.youtube.com/shorts/abcdefghijk', 'https://youtube.com/live/abcdefghijk']) {
    assert.equal(identity.youtubeVideoId(url), 'abcdefghijk');
  }
  for (const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com@evil.test/watch?v=abcdefghijk', 'https://example.com/abcdefghijk', 'https://youtu.be/short']) assert.equal(identity.youtubeVideoId(url), '');
});

test('share text extracts a video or playlist, not an unrelated link', () => {
  assert.equal(identity.sharedYouTubeUrl('Parça adı\nhttps://youtu.be/abcdefghijk?si=123'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(identity.sharedYouTubeUrl('https://www.youtube.com/playlist?list=PL123'), 'https://www.youtube.com/playlist?list=PL123');
  assert.equal(identity.sharedYouTubeUrl('https://example.com/watch?v=abcdefghijk'), '');
});

test('archive duplicate is checked by source ID even for a different format', async () => {
  const store = new Map([[historyKey, JSON.stringify([{ videoId: 'abcdefghijk', filename: 'old.m4a', download_url: 'file:///old.m4a' }])]]);
  const { api, calls } = setup({ store });
  const result = await api.startDownload({ ...options, type: 'mp4', quality: '720p' });
  assert.equal(result.duplicate.filename, 'old.m4a');
  assert.equal(calls.length, 0);
  await api.startDownload({ ...options, force: true });
  await until(() => api.getDownloadQueueState().tasks[0]?.status === 'completed');
  assert.equal(calls.length, 1);
});

test('missing files do not block downloading an archived video again', async () => {
  const store = new Map([[historyKey, JSON.stringify([{ videoId: 'abcdefghijk', filename: 'missing.m4a' }])]]);
  const { api } = setup({ store, native: { mediaFileExists: async () => false } });
  assert.equal((await api.startDownload(options)).duplicate, null);
  await until(() => api.getDownloadQueueState().tasks[0]?.status === 'completed');
});

test('rapid repeated taps create one native job', async () => {
  let finish;
  let count = 0;
  const { api } = setup({ native: { downloadResumable: () => { count++; return new Promise((resolve) => { finish = resolve; }); } } });
  const [first, second] = await Promise.all([api.startDownload(options), api.startDownload(options)]);
  assert.equal(first.taskId, second.taskId);
  assert.equal(count, 1);
  finish(completed);
  await until(() => api.getDownloadQueueState().tasks[0]?.status === 'completed');
});

test('interrupted jobs survive a fresh JS session and resume with the same native checkpoint ID', async () => {
  const first = setup({ native: { downloadResumable: async () => { throw new Error('Offline'); } } });
  const started = await first.api.startDownload(options);
  await until(() => !first.api.getDownloadQueueState().isBusy);
  assert.equal(first.api.getDownloadQueueState().tasks[0].status, 'paused');
  const second = setup({ store: first.store });
  await second.api.restoreDownloads();
  assert.equal(second.api.getDownloadQueueState().tasks[0].status, 'paused');
  assert.equal(second.calls.length, 0);
  await second.api.resumeDownload(started.taskId);
  await until(() => !second.api.getDownloadQueueState().isBusy);
  assert.equal(second.calls[0][3], started.taskId);
  assert.equal(JSON.parse(second.store.get(historyKey))[0].videoId, 'abcdefghijk');
  assert.equal(JSON.parse(second.store.get(queueKey))[0].status, 'completed');
});

test('a process-killed running task restores as paused and can be discarded', async () => {
  const store = new Map([[queueKey, JSON.stringify([{ id: 'native_123_ab', cleanUrl: options.url, type: 'm4a', quality: 'high', status: 'downloading' }])]]);
  const { api, removed } = setup({ store });
  await api.initializeDownloadQueue();
  assert.equal(api.getDownloadQueueState().tasks[0].status, 'paused');
  await api.cancelQueuedDownload('native_123_ab');
  assert.equal(api.getDownloadQueueState().tasks.length, 0);
  assert.deepEqual(removed, ['native_123_ab']);
  assert.equal(JSON.parse(store.get(queueKey)).length, 0);
});

test('cancelling during a Wi-Fi check does not start the cancelled task', async () => {
  let wifi;
  const store = new Map([['@mobil_media_toolkit_wifi_only', 'true']]);
  const { api, calls } = setup({ store, native: { isWifiConnected: () => new Promise((resolve) => { wifi = resolve; }) } });
  const job = await api.startDownload(options);
  await until(() => Boolean(wifi));
  await api.cancelQueuedDownload(job.taskId);
  wifi(true);
  await until(() => !api.getDownloadQueueState().isBusy);
  assert.equal(calls.length, 0);
});

test('queue storage failure prevents starting an untracked download', async () => {
  const { api, calls } = setup({ setItem: async () => { throw new Error('Storage full'); } });
  await assert.rejects(api.startDownload(options), /Storage full/);
  assert.equal(calls.length, 0);
  assert.equal(api.getDownloadQueueState().tasks.length, 0);
});

test('failed persistence while resuming leaves the task available to retry', async () => {
  const store = new Map([[queueKey, JSON.stringify([{ id: 'native_123_ab', cleanUrl: options.url, type: 'm4a', quality: 'high', status: 'paused' }])]]);
  const { api, calls } = setup({ store, setItem: async () => { throw new Error('Storage full'); } });
  await api.initializeDownloadQueue();
  await assert.rejects(api.resumeDownload('native_123_ab'), /Storage full/);
  assert.equal(api.getDownloadQueueState().tasks[0].status, 'paused');
  assert.equal(api.getDownloadQueueState().queuedCount, 0);
  assert.equal(calls.length, 0);
});

test('display and execution keep FIFO order, including restored older snapshots', async () => {
  const order = [];
  let releaseFirst;
  const { api } = setup({ native: { downloadResumable: (...args) => {
    order.push(args[0]);
    if (order.length === 1) return new Promise((resolve) => { releaseFirst = resolve; });
    return Promise.resolve({ ...completed, fileName: `${order.length}.m4a` });
  } } });
  const first = await api.startDownload(options);
  const second = await api.startDownload({ ...options, url: 'https://youtu.be/lmnopqrstuv' });
  const third = await api.startDownload({ ...options, url: 'https://youtu.be/12345678901' });
  assert.equal(api.getDownloadQueueState().tasks.map((task) => task.id).join(','), [first.taskId, second.taskId, third.taskId].join(','));
  releaseFirst(completed);
  await until(() => !api.getDownloadQueueState().isBusy);
  assert.deepEqual(order, ['abcdefghijk', 'lmnopqrstuv', '12345678901'].map((id) => `https://www.youtube.com/watch?v=${id}`));

  const store = new Map([[queueKey, JSON.stringify([
    { id: 'native_2_ab', cleanUrl: options.url, status: 'paused', createdAt: 200 },
    { id: 'native_1_ab', cleanUrl: options.url, status: 'paused', createdAt: 100 },
  ])]]);
  const restored = setup({ store });
  await restored.api.initializeDownloadQueue();
  assert.equal(restored.api.getDownloadQueueState().tasks[0].id, 'native_1_ab');
});
