/**
 * app.js
 * AR のぼり旗カメラ - アプリケーション エントリポイント
 */

import { ARScene } from './ar-scene.js?v=0.50';
import { BannerFlag } from './banner-flag.js?v=0.50';
import { TouchControls } from './touch-controls.js?v=0.50';
import { captureComposite, downloadBlob } from './capture.js?v=0.50';

// ────────── 定数 ──────────
const MAX_FLAGS = 3;
const MAX_PHOTOS = 10;

// ────────── アプリ状態 ──────────
let arScene = null;
let touchControls = null;
let animationId = null;
let selectedFlagIndex = -1;

/** @type {Array<{ blob: Blob, url: string, timestamp: number }>} */
const capturedPhotos = [];
let currentPhotoIndex = 0;

// ────────── DOM 参照 ──────────
const $ = (id) => document.getElementById(id);

const startScreen = $('startScreen');
const startBtn = $('startBtn');
const arView = $('arView');
const cameraVideo = $('cameraVideo');
const arCanvas = $('arCanvas');

const galleryBtn = $('galleryBtn');
const galleryCountBadge = $('galleryCountBadge');
const addFlagBtn = $('addFlagBtn');
const flagFileInput = $('flagFileInput');
const flagCountLabel = $('flagCount');
const shutterBtn = $('shutterBtn');

const panelHandle = $('panelHandle');
const panelExpanded = $('panelExpanded');
const controlPanel = $('controlPanel');

const poleColorInput = $('poleColor');
const standColorInput = $('standColor');
const flagOpacitySlider = $('flagOpacity');
const flagOpacityVal = $('flagOpacityVal');
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

// モーダル関連
const shareModal = $('shareModal');
const galleryModalTitle = $('galleryModalTitle');
const galleryEmptyState = $('galleryEmptyState');
const galleryContentArea = $('galleryContentArea');
const galleryThumbnails = $('galleryThumbnails');
const shareImagePreview = $('shareImagePreview');
const downloadModalBtn = $('downloadModalBtn');
const deletePhotoBtn = $('deletePhotoBtn');
const closeModalBtn = $('closeModalBtn');

const toast = $('toast');

// ────────── ユーティリティ ──────────

function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function updateFlagCount() {
  const count = arScene ? arScene.flags.length : 0;
  flagCountLabel.textContent = `${count}/${MAX_FLAGS}`;
  addFlagBtn.disabled = count >= MAX_FLAGS;
}

function updateSelectedFlagUI() {
  if (selectedFlagIndex >= 0 && arScene && arScene.flags[selectedFlagIndex]) {
    const flag = arScene.flags[selectedFlagIndex];
    selectedFlagControls.classList.add('visible');
    poleColorInput.value = flag.poleColor;
    standColorInput.value = flag.standColor;
    const opacityPct = Math.round(flag.opacity * 100);
    flagOpacitySlider.value = opacityPct;
    flagOpacityVal.textContent = `${opacityPct}%`;
  } else {
    selectedFlagControls.classList.remove('visible');
  }
}

// ────────── フォトライブラリ UI 管理 ──────────

function updateGalleryBadge() {
  const count = capturedPhotos.length;
  galleryCountBadge.textContent = count;
  galleryCountBadge.style.display = count > 0 ? 'inline-flex' : 'none';
}

function renderGalleryModal() {
  const count = capturedPhotos.length;
  galleryModalTitle.textContent = `撮影した写真 (${count} / ${MAX_PHOTOS}枚)`;

  if (count === 0) {
    galleryEmptyState.style.display = 'flex';
    galleryContentArea.style.display = 'none';
    return;
  }

  galleryEmptyState.style.display = 'none';
  galleryContentArea.style.display = 'flex';

  if (currentPhotoIndex >= count) currentPhotoIndex = count - 1;
  if (currentPhotoIndex < 0) currentPhotoIndex = 0;

  // サムネイル一覧の生成
  galleryThumbnails.innerHTML = '';
  capturedPhotos.forEach((photo, idx) => {
    const img = document.createElement('img');
    img.src = photo.url;
    img.className = 'gallery-thumb' + (idx === currentPhotoIndex ? ' active' : '');
    img.alt = `写真 ${idx + 1}`;
    img.addEventListener('click', () => {
      currentPhotoIndex = idx;
      renderGalleryModal();
    });
    galleryThumbnails.appendChild(img);
  });

  // 選択中写真のメインプレビュー
  shareImagePreview.src = capturedPhotos[currentPhotoIndex].url;
}

function openGalleryModal() {
  currentPhotoIndex = 0; // 最新の写真を選択
  renderGalleryModal();
  shareModal.style.display = 'flex';
}

function closeGalleryModal() {
  shareModal.style.display = 'none';
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
    return DeviceOrientationEvent.requestPermission().then(
      (permissionState) => permissionState === 'granted',
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
  arScene.render();
}

// ────────── アプリ起動 ──────────

async function startApp() {
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
  // 開始ボタン
  startBtn.addEventListener('click', startApp);

  // パネル開閉
  let panelOpen = false;
  panelHandle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panelExpanded.style.display = panelOpen ? 'block' : 'none';
    controlPanel.classList.toggle('expanded', panelOpen);
  });

  // 旗画像追加
  addFlagBtn.addEventListener('click', () => {
    if (arScene && arScene.flags.length >= MAX_FLAGS) {
      showToast(`のぼり旗は最大${MAX_FLAGS}セットまで配置できます。`);
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

      // タッチ操作対象にメッシュを登録
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

    flagFileInput.value = '';
  });

  // 旗削除
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

  // ポール / スタンド色変更
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

  // 旗の不透明度変更
  flagOpacitySlider.addEventListener('input', () => {
    const pct = parseInt(flagOpacitySlider.value, 10);
    flagOpacityVal.textContent = `${pct}%`;
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setOpacity(pct / 100);
    }
  });

  // 風パラメータ
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

  // ライトパラメータ
  lightAngleSlider.addEventListener('input', () => {
    const deg = parseInt(lightAngleSlider.value, 10);
    lightAngleVal.textContent = `${deg}°`;
    arScene?.setLightAzimuth(THREE.MathUtils.degToRad(deg));
  });
  lightStrengthSlider.addEventListener('input', () => {
    const pct = parseInt(lightStrengthSlider.value, 10);
    lightStrengthVal.textContent = `${pct}%`;
    arScene?.setLightIntensity((pct / 100) * 2.0);
  });

  // 影パラメータ
  shadowSlider.addEventListener('input', () => {
    const pct = parseInt(shadowSlider.value, 10);
    shadowVal.textContent = `${pct}%`;
    arScene?.setShadowOpacity(pct / 100);
  });

  // シャッター（写真一時保存）
  shutterBtn.addEventListener('click', async () => {
    if (!arScene) return;

    shutterBtn.disabled = true;
    shutterBtn.classList.add('capturing');

    try {
      const blob = await captureComposite(cameraVideo, arScene.renderer);
      const url = URL.createObjectURL(blob);

      // 最新写真を先頭に追加
      capturedPhotos.unshift({
        blob,
        url,
        timestamp: Date.now(),
      });

      // 最大枚数を超えた古い写真を破棄
      if (capturedPhotos.length > MAX_PHOTOS) {
        const removed = capturedPhotos.pop();
        if (removed) URL.revokeObjectURL(removed.url);
      }

      updateGalleryBadge();
      showToast(`写真を保存しました (${capturedPhotos.length}/${MAX_PHOTOS}枚)`);
    } catch (err) {
      console.error('キャプチャエラー:', err);
      showToast('写真の撮影に失敗しました。');
    }

    setTimeout(() => {
      shutterBtn.disabled = false;
      shutterBtn.classList.remove('capturing');
    }, 600);
  });

  // フォトライブラリ モーダル操作
  galleryBtn.addEventListener('click', openGalleryModal);
  closeModalBtn.addEventListener('click', closeGalleryModal);
  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) closeGalleryModal();
  });

  // モーダル内ダウンロード
  downloadModalBtn.addEventListener('click', () => {
    if (capturedPhotos.length === 0 || !capturedPhotos[currentPhotoIndex]) return;
    const photo = capturedPhotos[currentPhotoIndex];
    downloadBlob(photo.blob, `ar-banner-flag-${photo.timestamp}.png`);
    showToast('画像を端末にダウンロードしました');
  });

  // モーダル内写真削除
  deletePhotoBtn.addEventListener('click', () => {
    if (capturedPhotos.length === 0 || !capturedPhotos[currentPhotoIndex]) return;
    const removed = capturedPhotos.splice(currentPhotoIndex, 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    updateGalleryBadge();
    renderGalleryModal();
    showToast('写真を削除しました');
  });

  // トップページに戻る
  const backToHomeBtn = $('backToHomeBtn');
  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', () => {
      if (cameraVideo.srcObject) {
        cameraVideo.srcObject.getTracks().forEach((track) => track.stop());
        cameraVideo.srcObject = null;
      }

      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      panelOpen = false;
      panelExpanded.style.display = 'none';
      controlPanel.classList.remove('expanded');

      arView.style.display = 'none';
      startScreen.style.display = 'block';

      startBtn.disabled = false;
      startBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
        </svg>
        <span>ARカメラを起動する</span>
      `;
    });
  }
}

// ────────── 初期化 ──────────

document.addEventListener('DOMContentLoaded', () => {
  bindUIEvents();
  updateFlagCount();
  updateGalleryBadge();
});
