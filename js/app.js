/**
 * app.js
 * アプリケーション エントリポイント
 * カメラ起動 → ジャイロ許可 → シーン構築 → UI バインディング → レンダリングループ
 */

import { ARScene } from './ar-scene.js';
import { BannerFlag } from './banner-flag.js';
import { TouchControls } from './touch-controls.js';
import { captureComposite, downloadBlob } from './capture.js';

// ────────── 定数 ──────────
const MAX_FLAGS = 3;

// ────────── 状態 ──────────
let arScene = null;
let touchControls = null;
let animationId = null;
let selectedFlagIndex = -1;

// ────────── DOM 参照 ──────────
const $ = (id) => document.getElementById(id);

const startScreen = $('startScreen');
const startBtn = $('startBtn');
const arView = $('arView');
const cameraVideo = $('cameraVideo');
const arCanvas = $('arCanvas');

const addFlagBtn = $('addFlagBtn');
const flagFileInput = $('flagFileInput');
const flagCountLabel = $('flagCount');
const shutterBtn = $('shutterBtn');

const panelHandle = $('panelHandle');
const panelExpanded = $('panelExpanded');
const controlPanel = $('controlPanel');

const poleColorInput = $('poleColor');
const standColorInput = $('standColor');
const selectedFlagControls = $('selectedFlagControls');
const deleteFlagBtn = $('deleteFlagBtn');

const windAngleSlider = $('windAngle');
const windAngleVal = $('windAngleVal');
const windStrengthSlider = $('windStrength');
const windStrengthVal = $('windStrengthVal');
const lightAngleSlider = $('lightAngle');
const lightAngleVal = $('lightAngleVal');
const lightStrengthSlider = $('lightStrength');
const lightStrengthVal = $('lightStrengthVal');
const shadowSlider = $('shadowIntensity');
const shadowVal = $('shadowIntensityVal');

const toast = $('toast');

// ────────── ユーティリティ ──────────

function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function updateFlagCount() {
  const count = arScene ? arScene.flags.length : 0;
  flagCountLabel.textContent = `${count} / ${MAX_FLAGS}`;
  addFlagBtn.disabled = count >= MAX_FLAGS;
}

function updateSelectedFlagUI() {
  if (selectedFlagIndex >= 0 && arScene && arScene.flags[selectedFlagIndex]) {
    const flag = arScene.flags[selectedFlagIndex];
    selectedFlagControls.classList.add('visible');
    poleColorInput.value = flag.poleColor;
    standColorInput.value = flag.standColor;
  } else {
    selectedFlagControls.classList.remove('visible');
  }
}

// ────────── カメラ映像の取得 ──────────

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    return true;
  } catch (err) {
    console.error('カメラ取得失敗:', err);
    showToast('カメラへのアクセスが拒否されました。');
    return false;
  }
}

// ────────── ジャイロセンサー許可 (iOS) ──────────

function requestGyroPermissionSync() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ Safari: ユーザージェスチャの同期コンテキスト内で呼び出す必要がある
    return DeviceOrientationEvent.requestPermission().then(
      (permissionState) => {
        return permissionState === 'granted';
      },
      (err) => {
        console.warn('ジャイロ許可エラー:', err);
        return false;
      }
    );
  }
  return Promise.resolve(true);
}

// ────────── シーン初期化 ──────────

function initScene() {
  arScene = new ARScene(arCanvas, cameraVideo);
  touchControls = new TouchControls(arCanvas, arScene.camera, arScene.scene);

  // オブジェクト選択イベント
  arCanvas.addEventListener('flag-selected', (e) => {
    selectedFlagIndex = e.detail.index;
    updateSelectedFlagUI();
  });
  arCanvas.addEventListener('flag-deselected', () => {
    selectedFlagIndex = -1;
    updateSelectedFlagUI();
  });
}

// ────────── レンダリングループ ──────────

function animate() {
  animationId = requestAnimationFrame(animate);

  // タッチ操作中はジャイロ回転を抑制（視覚的な安定性のため）
  // → ARScene 側で orientationEnabled を参照しているが、
  //   ここでは touchControls.isInteracting を使って一時的に停止はしない
  //   （操作中も背景は動くのが自然）

  arScene.render();
}

// ────────── アプリ起動 ──────────

async function startApp() {
  // 1. iOS SafariのUser Gesture有効期限切れを防ぐため、最優先でジャイロ許可リクエストを開始
  const gyroPromise = requestGyroPermissionSync();

  startBtn.disabled = true;
  const originalHtml = startBtn.innerHTML;
  startBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
      <path d="M12 2a10 10 0 0 1 10 10"></path>
    </svg>
    <span>起動中...</span>
  `;

  // 2. カメラ映像の取得とジャイロ結果の待機を並行処理
  const [camOk, gyroOk] = await Promise.all([
    startCamera(),
    gyroPromise
  ]);

  if (!camOk) {
    startBtn.disabled = false;
    startBtn.innerHTML = originalHtml;
    return;
  }

  initScene();

  startScreen.style.display = 'none';
  arView.style.display = 'block';

  animate();

  if (!gyroOk) {
    showToast('ジャイロセンサーが無効です。カメラ映像のみで動作します。');
  }
}

// ────────── UI イベントバインディング ──────────

function bindUIEvents() {
  // ── 開始ボタン ──
  startBtn.addEventListener('click', startApp);

  // ── パネル開閉 ──
  let panelOpen = false;
  panelHandle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panelExpanded.style.display = panelOpen ? 'block' : 'none';
    controlPanel.classList.toggle('expanded', panelOpen);
  });

  // ── 旗画像追加 ──
  addFlagBtn.addEventListener('click', () => {
    if (arScene && arScene.flags.length >= MAX_FLAGS) {
      showToast('のぼり旗は最大3セットまで配置できます。');
      return;
    }
    flagFileInput.click();
  });

  flagFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !arScene) return;

    try {
      const url = URL.createObjectURL(file);
      const index = arScene.flags.length;
      const flag = new BannerFlag(index);
      await flag.loadFlagTexture(url);

      arScene.addFlag(flag);

      // タッチ操作対象に旗グループの全子メッシュを登録
      flag.group.traverse((child) => {
        if (child.isMesh) touchControls.addTarget(child);
      });

      selectedFlagIndex = index;
      updateFlagCount();
      updateSelectedFlagUI();
      showToast(`のぼり旗 ${index + 1} を配置しました。`);

      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('旗テクスチャ読み込みエラー:', err);
      showToast('画像の読み込みに失敗しました。');
    }

    // input をリセット（同じファイルを再選択可能にする）
    flagFileInput.value = '';
  });

  // ── 旗削除 ──
  deleteFlagBtn.addEventListener('click', () => {
    if (selectedFlagIndex < 0 || !arScene) return;
    const flag = arScene.flags[selectedFlagIndex];
    if (flag) {
      flag.group.traverse((child) => {
        if (child.isMesh) touchControls.removeTarget(child);
      });
      arScene.removeFlag(selectedFlagIndex);
      selectedFlagIndex = -1;
      updateFlagCount();
      updateSelectedFlagUI();
      showToast('のぼり旗を削除しました。');
    }
  });

  // ── ポール / スタンド色変更 ──
  poleColorInput.addEventListener('input', () => {
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setPoleColor(poleColorInput.value);
    }
  });
  standColorInput.addEventListener('input', () => {
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setStandColor(standColorInput.value);
    }
  });

  // ── 風パラメータ ──
  windAngleSlider.addEventListener('input', () => {
    const deg = parseInt(windAngleSlider.value, 10);
    windAngleVal.textContent = `${deg}°`;
    arScene?.setWindAngle(THREE.MathUtils.degToRad(deg));
  });
  windStrengthSlider.addEventListener('input', () => {
    const pct = parseInt(windStrengthSlider.value, 10);
    windStrengthVal.textContent = `${pct}%`;
    arScene?.setWindStrength(pct / 100);
  });

  // ── ライトパラメータ ──
  lightAngleSlider.addEventListener('input', () => {
    const deg = parseInt(lightAngleSlider.value, 10);
    lightAngleVal.textContent = `${deg}°`;
    arScene?.setLightAzimuth(THREE.MathUtils.degToRad(deg));
  });
  lightStrengthSlider.addEventListener('input', () => {
    const pct = parseInt(lightStrengthSlider.value, 10);
    lightStrengthVal.textContent = `${pct}%`;
    arScene?.setLightIntensity(pct / 100);
  });

  // ── 影パラメータ ──
  shadowSlider.addEventListener('input', () => {
    const pct = parseInt(shadowSlider.value, 10);
    shadowVal.textContent = `${pct}%`;
    arScene?.setShadowOpacity(pct / 100);
  });

  // ── シャッター ──
  shutterBtn.addEventListener('click', async () => {
    if (!arScene) return;

    shutterBtn.disabled = true;
    shutterBtn.classList.add('capturing');

    try {
      const blob = await captureComposite(cameraVideo, arScene.renderer);
      downloadBlob(blob);
      showToast('画像を保存しました！');
    } catch (err) {
      console.error('キャプチャエラー:', err);
      showToast('画像の保存に失敗しました。');
    }

    setTimeout(() => {
      shutterBtn.disabled = false;
      shutterBtn.classList.remove('capturing');
    }, 800);
  });
}

// ────────── 初期化 ──────────

document.addEventListener('DOMContentLoaded', () => {
  bindUIEvents();
  updateFlagCount();
});
