/**
 * app.js
 * AR のぼり旗カメラ - アプリケーション エントリポイント
 * ダッシュボード設定 & 個別調整モード、倍率変更（1x/2x/3x）、フォトライブラリ
 */

import { ARScene } from './ar-scene.js?v=0.91';
import { BannerFlag } from './banner-flag.js?v=0.91';
import { TouchControls } from './touch-controls.js?v=0.91';
import { captureComposite, downloadBlob } from './capture.js?v=0.91';

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

// ズーム状態 (1x / 2x / 3x)
let currentZoom = 1;

// 環境パラメータのデフォルト値
const DEFAULT_ENV_SETTINGS = {
  windAngle: 90,        // 度数法 (0〜360, 90°=右へ吹く)
  windStrength: 30,     // 0〜100 %
  lightAngle: 315,      // 度数法 (0〜360, 初期値315°)
  lightStrength: 100,   // 0〜100 %
  lightColorTemp: 50,   // 0:暖色 〜 50:自然光 〜 100:寒色
  shadowIntensity: 15,  // 0〜100 %
};

const ENV_SETTINGS_STORAGE_KEY = 'ar_banner_flag_env_settings';

// 環境パラメータ状態
const envSettings = { ...DEFAULT_ENV_SETTINGS };

function loadEnvSettings() {
  try {
    const saved = localStorage.getItem(ENV_SETTINGS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(envSettings, DEFAULT_ENV_SETTINGS, parsed);
    }
  } catch (err) {
    console.warn('LocalStorageからの環境設定読み込みに失敗:', err);
  }
}

function saveEnvSettings() {
  try {
    localStorage.setItem(ENV_SETTINGS_STORAGE_KEY, JSON.stringify(envSettings));
  } catch (err) {
    console.warn('LocalStorageへの環境設定保存に失敗:', err);
  }
}

// 起動時に保存済み環境設定をロード
loadEnvSettings();

// 個別設定編集用の一時状態
let activeSettingKey = null;
let activeSettingBackup = null;
let panelOpen = false;

// ────────── DOM 参照 ──────────
const $ = (id) => document.getElementById(id);

const startScreen = $('startScreen');
const startBtn = $('startBtn');
const arView = $('arView');
const cameraViewport = $('cameraViewport');
const cameraVideo = $('cameraVideo');
const arCanvas = $('arCanvas');
const flagTransformInfo = $('flagTransformInfo');

// 画面右上コントロール
const zoomToggleBtn = $('zoomToggleBtn');
const zoomLabel = $('zoomLabel');

// 下部コントロール
const galleryBtn = $('galleryBtn');
const galleryCountBadge = $('galleryCountBadge');
const addFlagBtn = $('addFlagBtn');
const flagFileInput = $('flagFileInput');
const flagCountLabel = $('flagCount');
const shutterBtn = $('shutterBtn');

const panelHandle = $('panelHandle');
const panelExpanded = $('panelExpanded');
const controlPanel = $('controlPanel');

// ダッシュボード要素
const flagDashboardSection = $('flagDashboardSection');
const selectedFlagTitle = $('selectedFlagTitle');
const switchFlagBtn = $('switchFlagBtn');
const deleteFlagBtn = $('deleteFlagBtn');
const resetEnvSettingsBtn = $('resetEnvSettingsBtn');
const backToHomeBtn = $('backToHomeBtn');

// 個別調整パネル要素
const singleSettingPanel = $('singleSettingPanel');
const singleSettingTitle = $('singleSettingTitle');
const singleSettingPreviewBox = document.querySelector('.setting-preview-box');
const singleSettingIcon = $('singleSettingIcon');
const singleSettingValue = $('singleSettingValue');
const singleSettingControlsNumeric = $('singleSettingControlsNumeric');
const singleSettingSlider = $('singleSettingSlider');
const adjustMinusBtn = $('adjustMinusBtn');
const adjustMinusIcon = $('adjustMinusIcon');
const adjustPlusBtn = $('adjustPlusBtn');
const adjustPlusIcon = $('adjustPlusIcon');
const singleSettingControlsColor = $('singleSettingControlsColor');
const singleSettingColorPicker = $('singleSettingColorPicker');
const singleSettingControlsColorTemp = $('singleSettingControlsColorTemp');
const singleSettingColorTempSlider = $('singleSettingColorTempSlider');
const singleSettingControlsSwitchFlag = $('singleSettingControlsSwitchFlag');
const flagSwitchList = $('flagSwitchList');
const singleSettingControlsFlip = $('singleSettingControlsFlip');
const flipHorizontalBtn = $('flipHorizontalBtn');
const flipVerticalBtn = $('flipVerticalBtn');
const singleSettingActionsDefault = $('singleSettingActionsDefault');
const singleSettingActionsSwitch = $('singleSettingActionsSwitch');
const settingCancelBtn = $('settingCancelBtn');
const settingConfirmBtn = $('settingConfirmBtn');
const switchCancelBtn = $('switchCancelBtn');
const switchSelectBtn = $('switchSelectBtn');
const switchApplyAndSelectBtn = $('switchApplyAndSelectBtn');

let pendingSwitchFlagIndex = -1;

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

// トップページ戻る確認モーダル
const confirmLeaveModal = $('confirmLeaveModal');
const confirmLeavePhotoCount = $('confirmLeavePhotoCount');
const confirmLeaveCancelBtn = $('confirmLeaveCancelBtn');
const confirmLeaveOkBtn = $('confirmLeaveOkBtn');

const toast = $('toast');

// ────────── ユーティリティ ──────────

function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function updateFlagCount() {
  const count = arScene ? arScene.flags.length : 0;
  flagCountLabel.textContent = count;
  if (count >= MAX_FLAGS) {
    flagCountLabel.classList.add('badge-max');
    addFlagBtn.disabled = true;
  } else {
    flagCountLabel.classList.remove('badge-max');
    addFlagBtn.disabled = false;
  }
}

// ────────── 動的 SVG アイコン生成 ──────────

/**
 * 風の強さ (4段階: 0 / 1-30 / 31-70 / 71-100)
 */
function getWindStrengthSvg(pct) {
  if (pct === 0) {
    return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
  } else if (pct <= 30) {
    return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/></svg>`;
  } else if (pct <= 70) {
    return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/></svg>`;
  } else {
    return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path></svg>`;
  }
}

/**
 * 光の強さ (4段階: 0 / 1-30 / 31-70 / 71-100)
 */
function getLightStrengthSvg(pct) {
  if (pct === 0) {
    return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="14" cy="14" r="5" stroke-dasharray="2 2"/></svg>`;
  } else if (pct <= 30) {
    return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="14" cy="14" r="4"/><line x1="14" y1="4" x2="14" y2="6"/><line x1="14" y1="22" x2="14" y2="24"/><line x1="4" y1="14" x2="6" y2="14"/><line x1="22" y1="14" x2="24" y2="14"/></svg>`;
  } else if (pct <= 70) {
    return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="14" cy="14" r="4.5"/><line x1="14" y1="3" x2="14" y2="6"/><line x1="14" y1="22" x2="14" y2="25"/><line x1="3" y1="14" x2="6" y2="14"/><line x1="22" y1="14" x2="25" y2="14"/><line x1="6.2" y1="6.2" x2="8.3" y2="8.3"/><line x1="19.7" y1="19.7" x2="21.8" y2="21.8"/><line x1="6.2" y1="21.8" x2="8.3" y2="19.7"/><line x1="19.7" y1="8.3" x2="21.8" y2="6.2"/></svg>`;
  } else {
    return `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="14" cy="14" r="5" fill="currentColor" fill-opacity="0.2"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="14" y1="22" x2="14" y2="26"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="22" y1="14" x2="26" y2="14"/><line x1="5.5" y1="5.5" x2="8.3" y2="8.3"/><line x1="19.7" y1="19.7" x2="22.5" y2="22.5"/><line x1="5.5" y1="22.5" x2="8.3" y2="19.7"/><line x1="19.7" y1="8.3" x2="22.5" y2="5.5"/></svg>`;
  }
}

/**
 * 影の濃さ (光の向きに応じて影の方向が自動変化)
 * @param {number} pct - 影の濃さ (0〜100%)
 * @param {number} [angleDeg] - 光の向き角度 (0〜360°)
 */
function getShadowIntensitySvg(pct, angleDeg = (envSettings?.lightAngle ?? 135)) {
  const rad = (angleDeg * Math.PI) / 180;
  const offsetDist = 3.6;
  const dx = (Math.sin(rad) * offsetDist).toFixed(1);
  const dy = (-Math.cos(rad) * offsetDist).toFixed(1);
  const fillOpacity = Math.max(0.12, Math.min(0.6, (pct / 100) * 0.45 + 0.1));

  return `
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" fill-opacity="${fillOpacity}" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 2" transform="translate(${dx}, ${dy})" />
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="#ffffff" stroke="currentColor" stroke-width="2" />
    </svg>
  `;
}

/**
 * 風の向き (左上に風シンボルバッジ + 中央にコンパス円&回転矢印)
 */
function getWindDirectionSvg(deg) {
  return `
    <div class="dir-icon-badge-wrapper">
      <span class="dir-symbol-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path>
        </svg>
      </span>
      <svg class="dir-compass" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-dasharray="2.5 2.5" opacity="0.35" stroke-width="1.2"/>
        <g transform="translate(16, 16) rotate(${deg}) translate(-16, -16)">
          <line x1="16" y1="23" x2="16" y2="9" stroke-width="2.2"/>
          <polyline points="12 13 16 9 20 13" stroke-width="2.5"/>
        </g>
      </svg>
    </div>
  `;
}

/**
 * 光の向き (左上に太陽シンボルバッジ[100%光強度と同じ] + 中央にコンパス円&回転矢印)
 */
function getLightDirectionSvg(deg) {
  return `
    <div class="dir-icon-badge-wrapper">
      <span class="dir-symbol-badge">
        <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="14" cy="14" r="5" fill="currentColor" fill-opacity="0.2"/>
          <line x1="14" y1="2" x2="14" y2="6"/>
          <line x1="14" y1="22" x2="14" y2="26"/>
          <line x1="2" y1="14" x2="6" y2="14"/>
          <line x1="22" y1="14" x2="26" y2="14"/>
          <line x1="5.5" y1="5.5" x2="8.3" y2="8.3"/>
          <line x1="19.7" y1="19.7" x2="22.5" y2="22.5"/>
          <line x1="5.5" y1="22.5" x2="8.3" y2="19.7"/>
          <line x1="19.7" y1="8.3" x2="22.5" y2="5.5"/>
        </svg>
      </span>
      <svg class="dir-compass" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-dasharray="2.5 2.5" opacity="0.35" stroke-width="1.2"/>
        <g transform="translate(16, 16) rotate(${deg}) translate(-16, -16)">
          <line x1="16" y1="23" x2="16" y2="9" stroke-width="2.2"/>
          <polyline points="12 13 16 9 20 13" stroke-width="2.5"/>
        </g>
      </svg>
    </div>
  `;
}

/**
 * 色温度 (0:暖色 〜 50:自然光 〜 100:寒色) から HEX カラーを算出
 */
function calcColorFromTemp(temp) {
  let r, g, b;
  if (temp <= 50) {
    const k = temp / 50; // 0 -> 1
    r = 255;
    g = Math.round(148 + (255 - 148) * k);
    b = Math.round(77 + (255 - 77) * k);
  } else {
    const k = (temp - 50) / 50; // 0 -> 1
    r = Math.round(255 + (128 - 255) * k);
    g = Math.round(255 + (191 - 255) * k);
    b = 255;
  }
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * 色温度のラベル
 */
function getTempLabel(temp) {
  if (temp <= 15) return '暖色';
  if (temp <= 35) return '温白色';
  if (temp <= 65) return '自然光';
  if (temp <= 85) return '昼光色';
  return '寒色';
}

/**
 * 光源の色 (太陽アイコン + 現在の光色)
 */
function getLightColorSvg(temp) {
  const hex = calcColorFromTemp(temp);
  const strokeBorder = (temp >= 40 && temp <= 60) ? '#888888' : hex;
  return `
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="${strokeBorder}" stroke-width="2.2" stroke-linecap="round">
      <circle cx="14" cy="14" r="5" fill="${hex}" stroke="${strokeBorder}" stroke-width="1.2"/>
      <line x1="14" y1="2" x2="14" y2="6"/>
      <line x1="14" y1="22" x2="14" y2="26"/>
      <line x1="2" y1="14" x2="6" y2="14"/>
      <line x1="22" y1="14" x2="26" y2="14"/>
      <line x1="5.5" y1="5.5" x2="8.3" y2="8.3"/>
      <line x1="19.7" y1="19.7" x2="22.5" y2="22.5"/>
      <line x1="5.5" y1="22.5" x2="8.3" y2="19.7"/>
      <line x1="19.7" y1="8.3" x2="22.5" y2="5.5"/>
    </svg>
  `;
}

/**
 * 旗の向き (左上に旗シンボルバッジ + 中央にコンパス円&回転矢印)
 */
function getFlagRotationSvg(deg) {
  return `
    <div class="dir-icon-badge-wrapper">
      <span class="dir-symbol-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
          <line x1="4" y1="22" x2="4" y2="15"></line>
        </svg>
      </span>
      <svg class="dir-compass" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-dasharray="2.5 2.5" opacity="0.35" stroke-width="1.2"/>
        <g transform="translate(16, 16) rotate(${deg}) translate(-16, -16)">
          <line x1="16" y1="23" x2="16" y2="9" stroke-width="2.2"/>
          <polyline points="12 13 16 9 20 13" stroke-width="2.5"/>
        </g>
      </svg>
    </div>
  `;
}

/**
 * 旗の反転 (左上に旗シンボルバッジ + メインに symmetry-vertical)
 */
function getFlagFlipSvg() {
  return `
    <div class="dir-icon-badge-wrapper">
      <span class="dir-symbol-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
          <line x1="4" y1="22" x2="4" y2="15"></line>
        </svg>
      </span>
      <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor">
        <path d="M7 2.5a.5.5 0 0 0-.939-.24l-6 11A.5.5 0 0 0 .5 14h6a.5.5 0 0 0 .5-.5zm2.376-.484a.5.5 0 0 1 .563.245l6 11A.5.5 0 0 1 15.5 14h-6a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .376-.484M10 4.46V13h4.658z"/>
      </svg>
    </div>
  `;
}

function getFlipLabel(flipH, flipV) {
  if (flipH && flipV) return '水平+垂直';
  if (flipH) return '水平';
  if (flipV) return '垂直';
  return '標準';
}

/**
 * 旗の不透明度
 */
function getOpacitySvg(pct) {
  const op = pct / 100;
  return `
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="5" y="5" width="18" height="18" rx="4" stroke="currentColor"/>
      <rect x="9" y="9" width="10" height="10" rx="2" fill="currentColor" fill-opacity="${op}"/>
    </svg>
  `;
}

/**
 * カラーチップ
 */
function getColorSvg(colorHex) {
  return `
    <svg viewBox="0 0 28 28" width="28" height="28">
      <circle cx="14" cy="14" r="10" fill="${colorHex}" stroke="#ffffff" stroke-width="2"/>
      <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>
    </svg>
  `;
}

// ────────── ダッシュボードUI更新 ──────────

function updateDashboardUI() {
  // 1. 環境設定
  $('tileIconWindAngle').innerHTML = getWindDirectionSvg(envSettings.windAngle);
  $('tileValWindAngle').textContent = `${envSettings.windAngle}°`;

  $('tileIconWindStrength').innerHTML = getWindStrengthSvg(envSettings.windStrength);
  $('tileValWindStrength').textContent = `${envSettings.windStrength}%`;

  $('tileIconLightAngle').innerHTML = getLightDirectionSvg(envSettings.lightAngle);
  $('tileValLightAngle').textContent = `${envSettings.lightAngle}°`;

  $('tileIconLightStrength').innerHTML = getLightStrengthSvg(envSettings.lightStrength);
  $('tileValLightStrength').textContent = `${envSettings.lightStrength}%`;

  $('tileIconLightColor').innerHTML = getLightColorSvg(envSettings.lightColorTemp);
  $('tileValLightColor').textContent = getTempLabel(envSettings.lightColorTemp);

  $('tileIconShadowIntensity').innerHTML = getShadowIntensitySvg(envSettings.shadowIntensity);
  $('tileValShadowIntensity').textContent = `${envSettings.shadowIntensity}%`;

  // 2. 旗設定
  if (selectedFlagIndex >= 0 && arScene && arScene.flags[selectedFlagIndex]) {
    const flag = arScene.flags[selectedFlagIndex];
    flagDashboardSection.style.display = 'block';
    selectedFlagTitle.textContent = `選択中の旗 ${selectedFlagIndex + 1}`;

    // 旗が2つ以上で切替ボタンを有効化
    if (switchFlagBtn) {
      switchFlagBtn.disabled = (!arScene || arScene.flags.length <= 1);
    }

    // 旗の回転角度マッピング (90°基準・時計回り)
    const rotDeg = Math.round((90 - THREE.MathUtils.radToDeg(flag.rotationY)) % 360 + 360) % 360;
    $('tileIconFlagRotation').innerHTML = getFlagRotationSvg(rotDeg);
    $('tileValFlagRotation').textContent = `${rotDeg}°`;

    $('tileIconFlagFlip').innerHTML = getFlagFlipSvg();
    $('tileValFlagFlip').textContent = getFlipLabel(flag.flipH, flag.flipV);

    const opPct = Math.round(flag.opacity * 100);
    $('tileIconFlagOpacity').innerHTML = getOpacitySvg(opPct);
    $('tileValFlagOpacity').textContent = `${opPct}%`;

    $('tileIconPoleColor').innerHTML = getColorSvg(flag.poleColor);
    $('tileValPoleColor').textContent = flag.poleColor.toUpperCase();

    $('tileIconStandColor').innerHTML = getColorSvg(flag.standColor);
    $('tileValStandColor').textContent = flag.standColor.toUpperCase();
  } else {
    flagDashboardSection.style.display = 'none';
  }
}

// ────────── 個別調整モード (単一設定パネル) ──────────

function updateColorTempPresetButtons(val) {
  const chips = document.querySelectorAll('.btn-temp-chip');
  chips.forEach((chip) => {
    const temp = parseInt(chip.getAttribute('data-temp'), 10);
    if (Math.abs(temp - val) <= 12) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

/**
 * 選択中の旗の頭上▼マーカーの表示・非表示を制御
 */
/**
 * 旗の個別設定パネル表示中、選択中でない他の旗全体（布地・ポール・スタンド）を半透明にする
 */
function updateFlagDimming() {
  if (!arScene || !arScene.flags) return;

  const isFlagSingleSetting = (
    activeSettingKey === 'flagRotation' ||
    activeSettingKey === 'flagFlip' ||
    activeSettingKey === 'flagOpacity' ||
    activeSettingKey === 'poleColor' ||
    activeSettingKey === 'standColor'
  );

  const isSwitchPanel = (activeSettingKey === 'switchFlag');

  if (isFlagSingleSetting && selectedFlagIndex >= 0) {
    // 旗の個別調整中: 選択中の旗のみ通常表示、それ以外の旗全体を半透明にする
    arScene.flags.forEach((flag, idx) => {
      flag.setDimmed(idx !== selectedFlagIndex);
    });
  } else if (isSwitchPanel) {
    // 旗切り替えパネル中: 候補旗 (または現在の旗) のみ通常表示、それ以外を半透明にする
    const activeIdx = pendingSwitchFlagIndex >= 0 ? pendingSwitchFlagIndex : selectedFlagIndex;
    arScene.flags.forEach((flag, idx) => {
      flag.setDimmed(idx !== activeIdx);
    });
  } else {
    // パネル非表示時または環境設定時: すべて通常表示
    arScene.flags.forEach((flag) => {
      flag.setDimmed(false);
    });
  }
}

function updateFlagMarkerVisibility() {
  if (!arScene) return;

  updateFlagDimming();

  const hasSelected = selectedFlagIndex >= 0 && arScene.flags[selectedFlagIndex];
  if (!hasSelected) {
    arScene.setSelectedFlagMarker(null, false, null, false);
    return;
  }

  // 1) 旗切り替えパネルが表示中
  if (activeSettingKey === 'switchFlag') {
    const currentFlag = arScene.flags[selectedFlagIndex];
    const targetFlag = (pendingSwitchFlagIndex >= 0 && arScene.flags[pendingSwitchFlagIndex])
      ? arScene.flags[pendingSwitchFlagIndex]
      : currentFlag;

    if (targetFlag === currentFlag) {
      // リストで選択中の旗が「現在の旗」と同じ場合: 不透明で1つだけ表示
      arScene.setSelectedFlagMarker(targetFlag, true, null, false);
    } else {
      // リストで選択中の旗: 不透明 (プライマリ)
      // 現在の旗: 半透明 (セカンダリ)
      arScene.setSelectedFlagMarker(targetFlag, true, currentFlag, true);
    }
    return;
  }

  // 2) コントロールパネルが展開されている (panelOpen && !panel-hidden)
  // 3) または、単一の旗の個別調整パネルが表示中
  const isFlagSetting = (
    activeSettingKey === 'flagRotation' ||
    activeSettingKey === 'flagFlip' ||
    activeSettingKey === 'flagOpacity' ||
    activeSettingKey === 'poleColor' ||
    activeSettingKey === 'standColor'
  );

  const shouldShow = (panelOpen && !controlPanel.classList.contains('panel-hidden')) || isFlagSetting;
  const selectedFlag = arScene.flags[selectedFlagIndex];
  arScene.setSelectedFlagMarker(selectedFlag, shouldShow, null, false);
}

/**
 * 環境・ライティング設定を初期値にリセット
 */
function resetEnvSettings() {
  Object.assign(envSettings, DEFAULT_ENV_SETTINGS);
  saveEnvSettings();

  if (arScene) {
    arScene.setWindAngle(THREE.MathUtils.degToRad(envSettings.windAngle));
    arScene.setWindStrength(envSettings.windStrength / 100);
    arScene.setLightAzimuth(THREE.MathUtils.degToRad((envSettings.lightAngle + 90) % 360));
    arScene.setLightIntensity((envSettings.lightStrength / 100) * 2.0);
    arScene.setLightColor(calcColorFromTemp(envSettings.lightColorTemp));
    arScene.setShadowOpacity(envSettings.shadowIntensity / 100);
  }

  updateDashboardUI();
  showToast('環境・ライティング設定を初期値に戻しました');
}

/**
 * 旗切り替え用サムネイル一覧を描画
 */
function renderFlagSwitchList() {
  if (!flagSwitchList || !arScene) return;
  flagSwitchList.innerHTML = '';

  arScene.flags.forEach((flag, idx) => {
    const card = document.createElement('div');
    card.className = 'flag-switch-card' + (idx === pendingSwitchFlagIndex ? ' selected' : '');
    card.setAttribute('data-index', idx);

    // サムネイル画像
    const img = document.createElement('img');
    img.className = 'flag-switch-thumb';
    img.alt = `旗 ${idx + 1}`;
    if (flag.thumbnailUrl) {
      img.src = flag.thumbnailUrl;
    } else {
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="46" height="76" fill="%23e0e0e0"><rect width="100%" height="100%"/></svg>';
    }
    card.appendChild(img);

    // 旗番号テキスト
    const name = document.createElement('div');
    name.className = 'flag-switch-name';
    name.textContent = `旗 ${idx + 1}`;
    card.appendChild(name);

    // 現在選択中バッジ
    if (idx === selectedFlagIndex) {
      const badge = document.createElement('div');
      badge.className = 'flag-switch-badge';
      badge.textContent = '選択中';
      card.appendChild(badge);
    }

    // クリックイベント
    card.addEventListener('click', () => {
      pendingSwitchFlagIndex = idx;
      renderFlagSwitchList();
      updateFlagMarkerVisibility();
    });

    flagSwitchList.appendChild(card);
  });

  // 現在選択中の旗そのものを指定している場合は無効化
  if (switchApplyAndSelectBtn) {
    switchApplyAndSelectBtn.disabled = (pendingSwitchFlagIndex === selectedFlagIndex);
  }
}

/**
 * 旗切り替えパネルを開く
 */
function openSwitchFlagPanel() {
  if (!arScene || arScene.flags.length <= 1) return;

  activeSettingKey = 'switchFlag';

  // コントロールパネルを下へスライドアウト & 個別設定パネルを下からスライドイン
  singleSettingPanel.style.display = 'block';
  requestAnimationFrame(() => {
    controlPanel.classList.add('panel-hidden');
    singleSettingPanel.classList.add('panel-active');

    // プレビュー画面の位置を調整
    const panelHeight = singleSettingPanel.offsetHeight || 210;
    const shiftY = -Math.round(panelHeight / 2);
    if (cameraViewport) {
      cameraViewport.style.setProperty('--shift-y', `${shiftY}px`);
    }

    updateFlagMarkerVisibility();
  });

  singleSettingTitle.textContent = '旗の切り替え';
  if (singleSettingPreviewBox) singleSettingPreviewBox.style.display = 'none';
  singleSettingControlsNumeric.style.display = 'none';
  singleSettingControlsColor.style.display = 'none';
  singleSettingControlsColorTemp.style.display = 'none';
  singleSettingControlsSwitchFlag.style.display = 'block';

  singleSettingActionsDefault.style.display = 'none';
  singleSettingActionsSwitch.style.display = 'flex';

  // 切り替え候補の初期値: 現在の旗とは別の旗をフォーカス
  pendingSwitchFlagIndex = (selectedFlagIndex + 1) % arScene.flags.length;

  renderFlagSwitchList();
}

function openSingleSetting(key) {
  activeSettingKey = key;

  // 通常モードのUI要素を表示
  if (singleSettingPreviewBox) singleSettingPreviewBox.style.display = 'flex';
  if (singleSettingControlsSwitchFlag) singleSettingControlsSwitchFlag.style.display = 'none';
  if (singleSettingActionsDefault) singleSettingActionsDefault.style.display = 'flex';
  if (singleSettingActionsSwitch) singleSettingActionsSwitch.style.display = 'none';

  // コントロールパネルを下へスライドアウト & 個別設定パネルを下からスライドイン
  singleSettingPanel.style.display = 'block';
  requestAnimationFrame(() => {
    controlPanel.classList.add('panel-hidden');
    singleSettingPanel.classList.add('panel-active');

    // プレビュー画面の位置を調整
    const panelHeight = singleSettingPanel.offsetHeight || 190;
    const shiftY = -Math.round(panelHeight / 2);
    if (cameraViewport) {
      cameraViewport.style.setProperty('--shift-y', `${shiftY}px`);
    }

    updateFlagMarkerVisibility();
  });

  // 風向き・風の強さ調整時の可視化エフェクト
  if (key === 'windAngle') {
    arScene?.setWindVisualizer(true, 'angle');
  } else if (key === 'windStrength') {
    arScene?.setWindVisualizer(true, 'strength');
  }

  // モード別初期化
  if (key === 'flagFlip') {
    singleSettingControlsNumeric.style.display = 'none';
    singleSettingControlsColor.style.display = 'none';
    singleSettingControlsColorTemp.style.display = 'none';
    if (singleSettingControlsFlip) singleSettingControlsFlip.style.display = 'flex';

    const flag = arScene.flags[selectedFlagIndex];
    activeSettingBackup = { flipH: flag.flipH, flipV: flag.flipV };

    singleSettingTitle.textContent = '旗の反転';
    if (flipHorizontalBtn) flipHorizontalBtn.classList.toggle('active', flag.flipH);
    if (flipVerticalBtn) flipVerticalBtn.classList.toggle('active', flag.flipV);

    updateSingleSettingPreview(key, { flipH: flag.flipH, flipV: flag.flipV });
  } else if (key === 'poleColor' || key === 'standColor') {
    singleSettingControlsNumeric.style.display = 'none';
    singleSettingControlsColor.style.display = 'block';
    singleSettingControlsColorTemp.style.display = 'none';
    if (singleSettingControlsFlip) singleSettingControlsFlip.style.display = 'none';

    const flag = arScene.flags[selectedFlagIndex];
    const currentColor = key === 'poleColor' ? flag.poleColor : flag.standColor;
    activeSettingBackup = currentColor;

    singleSettingTitle.textContent = key === 'poleColor' ? 'ポールの色' : 'スタンドの色';
    singleSettingColorPicker.value = currentColor;
    updateSingleSettingPreview(key, currentColor);
  } else if (key === 'lightColor') {
    singleSettingControlsNumeric.style.display = 'none';
    singleSettingControlsColor.style.display = 'none';
    singleSettingControlsColorTemp.style.display = 'block';
    if (singleSettingControlsFlip) singleSettingControlsFlip.style.display = 'none';

    activeSettingBackup = envSettings.lightColorTemp;
    singleSettingTitle.textContent = '光の色 (色温度)';
    singleSettingColorTempSlider.value = envSettings.lightColorTemp;
    updateColorTempPresetButtons(envSettings.lightColorTemp);
    updateSingleSettingPreview(key, envSettings.lightColorTemp);
  } else {
    singleSettingControlsNumeric.style.display = 'flex';
    singleSettingControlsColor.style.display = 'none';
    singleSettingControlsColorTemp.style.display = 'none';
    if (singleSettingControlsFlip) singleSettingControlsFlip.style.display = 'none';

    let min = 0;
    let max = 100;
    let step = 1;
    let currentVal = 0;
    let title = '';

    const isRotation = (key === 'windAngle' || key === 'lightAngle' || key === 'flagRotation');

    if (isRotation) {
      min = 0;
      max = 360;
      step = 5;
      // 反時計回り (減少)
      adjustMinusIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      `;
      // 時計回り (増加)
      adjustPlusIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      `;

      if (key === 'windAngle') {
        currentVal = envSettings.windAngle;
        title = '風の向き';
      } else if (key === 'lightAngle') {
        currentVal = envSettings.lightAngle;
        title = '光の向き';
      } else if (key === 'flagRotation') {
        const flag = arScene.flags[selectedFlagIndex];
        currentVal = Math.round((90 - THREE.MathUtils.radToDeg(flag.rotationY)) % 360 + 360) % 360;
        title = '旗の向き';
      }
    } else {
      adjustMinusIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      `;
      adjustPlusIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      `;

      if (key === 'windStrength') {
        currentVal = envSettings.windStrength;
        title = '風の強さ';
      } else if (key === 'lightStrength') {
        currentVal = envSettings.lightStrength;
        title = '光の強さ';
      } else if (key === 'shadowIntensity') {
        currentVal = envSettings.shadowIntensity;
        title = '影の濃さ';
      } else if (key === 'flagOpacity') {
        const flag = arScene.flags[selectedFlagIndex];
        currentVal = Math.round(flag.opacity * 100);
        title = '旗の透明度';
      }
    }

    activeSettingBackup = currentVal;
    singleSettingTitle.textContent = title;
    singleSettingSlider.min = min;
    singleSettingSlider.max = max;
    singleSettingSlider.step = step;
    singleSettingSlider.value = currentVal;

    updateSingleSettingPreview(key, currentVal);
  }
}

function updateSingleSettingPreview(key, val) {
  if (key === 'windAngle') {
    singleSettingIcon.innerHTML = getWindDirectionSvg(val);
    singleSettingValue.textContent = `${val}°`;
    arScene?.setWindAngle(THREE.MathUtils.degToRad(val));
    envSettings.windAngle = val;
  } else if (key === 'windStrength') {
    singleSettingIcon.innerHTML = getWindStrengthSvg(val);
    singleSettingValue.textContent = `${val}%`;
    arScene?.setWindStrength(val / 100);
    envSettings.windStrength = val;
  } else if (key === 'lightAngle') {
    singleSettingIcon.innerHTML = getLightDirectionSvg(val);
    singleSettingValue.textContent = `${val}°`;
    // 光源の方位角オフセット (+90°)
    arScene?.setLightAzimuth(THREE.MathUtils.degToRad((val + 90) % 360));
    envSettings.lightAngle = val;
    // 影の濃さタイルのアイコンも光の向きにリアルタイム連動
    const shadowTileIcon = $('tileIconShadowIntensity');
    if (shadowTileIcon) {
      shadowTileIcon.innerHTML = getShadowIntensitySvg(envSettings.shadowIntensity, val);
    }
  } else if (key === 'lightStrength') {
    singleSettingIcon.innerHTML = getLightStrengthSvg(val);
    singleSettingValue.textContent = `${val}%`;
    arScene?.setLightIntensity((val / 100) * 2.0);
    envSettings.lightStrength = val;
  } else if (key === 'shadowIntensity') {
    singleSettingIcon.innerHTML = getShadowIntensitySvg(val, envSettings.lightAngle);
    singleSettingValue.textContent = `${val}%`;
    arScene?.setShadowOpacity(val / 100);
    envSettings.shadowIntensity = val;
  } else if (key === 'flagRotation') {
    singleSettingIcon.innerHTML = getFlagRotationSvg(val);
    singleSettingValue.textContent = `${val}°`;
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      // 旗の回転角度マッピング (90°基準・時計回り)
      const rad = -THREE.MathUtils.degToRad(val - 90);
      arScene.flags[selectedFlagIndex].setRotationY(rad);
    }
  } else if (key === 'flagFlip') {
    singleSettingIcon.innerHTML = getFlagFlipSvg();
    singleSettingValue.textContent = getFlipLabel(val.flipH, val.flipV);
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setFlip(val.flipH, val.flipV);
    }
    if (flipHorizontalBtn) flipHorizontalBtn.classList.toggle('active', Boolean(val.flipH));
    if (flipVerticalBtn) flipVerticalBtn.classList.toggle('active', Boolean(val.flipV));
  } else if (key === 'flagOpacity') {
    singleSettingIcon.innerHTML = getOpacitySvg(val);
    singleSettingValue.textContent = `${val}%`;
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setOpacity(val / 100);
    }
  } else if (key === 'lightColor') {
    singleSettingIcon.innerHTML = getLightColorSvg(val);
    singleSettingValue.textContent = getTempLabel(val);
    const hex = calcColorFromTemp(val);
    arScene?.setLightColor(hex);
    envSettings.lightColorTemp = val;
    updateColorTempPresetButtons(val);
  } else if (key === 'poleColor') {
    singleSettingIcon.innerHTML = getColorSvg(val);
    singleSettingValue.textContent = val.toUpperCase();
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setPoleColor(val);
    }
  } else if (key === 'standColor') {
    singleSettingIcon.innerHTML = getColorSvg(val);
    singleSettingValue.textContent = val.toUpperCase();
    if (selectedFlagIndex >= 0 && arScene?.flags[selectedFlagIndex]) {
      arScene.flags[selectedFlagIndex].setStandColor(val);
    }
  }
}

function cancelSingleSetting() {
  if (activeSettingKey) {
    updateSingleSettingPreview(activeSettingKey, activeSettingBackup);
  }
  saveEnvSettings();
  closeSingleSetting();
}

function confirmSingleSetting() {
  saveEnvSettings();
  closeSingleSetting();
}

/**
 * 通常時 (未展開コントロールパネル) のビューポート上部シフト量を取得
 * 未展開コントロールパネルの高さの半分を上に移動
 */
function getDefaultViewportShift() {
  const handleH = panelHandle?.offsetHeight || 33;
  const actionsEl = controlPanel?.querySelector('.panel-main-actions');
  const actionsH = actionsEl ? actionsEl.offsetHeight : 82;
  const padBottom = controlPanel ? (parseInt(window.getComputedStyle(controlPanel).paddingBottom, 10) || 0) : 0;
  const collapsedHeight = handleH + actionsH + padBottom;
  return -Math.round(collapsedHeight / 2);
}

function resetViewportToDefault() {
  if (cameraViewport) {
    cameraViewport.style.setProperty('--shift-y', `${getDefaultViewportShift()}px`);
  }
}

function closeSingleSetting() {
  // プレビュー画面の位置を通常位置に戻す
  resetViewportToDefault();

  // 風向き可視化エフェクトを無効化
  arScene?.setWindVisualizer(false);

  // 個別設定パネルを下へスライドアウト & コントロールパネルを下からスライドイン
  singleSettingPanel.classList.remove('panel-active');
  controlPanel.classList.remove('panel-hidden');

  setTimeout(() => {
    if (!activeSettingKey) {
      singleSettingPanel.style.display = 'none';
      if (singleSettingPreviewBox) singleSettingPreviewBox.style.display = 'flex';
      if (singleSettingControlsSwitchFlag) singleSettingControlsSwitchFlag.style.display = 'none';
      if (singleSettingControlsFlip) singleSettingControlsFlip.style.display = 'none';
      if (singleSettingActionsDefault) singleSettingActionsDefault.style.display = 'flex';
      if (singleSettingActionsSwitch) singleSettingActionsSwitch.style.display = 'none';
    }
  }, 280);

  activeSettingKey = null;
  activeSettingBackup = null;
  updateDashboardUI();
  updateFlagMarkerVisibility();
}

// ────────── フォトライブラリ UI 管理 ──────────

function updateGalleryBadge() {
  const count = capturedPhotos.length;
  galleryCountBadge.textContent = count;
  galleryCountBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  if (count >= MAX_PHOTOS) {
    galleryCountBadge.classList.add('badge-max');
  } else {
    galleryCountBadge.classList.remove('badge-max');
  }
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
  currentPhotoIndex = 0;
  renderGalleryModal();
  shareModal.style.display = 'flex';
}

function closeGalleryModal() {
  shareModal.style.display = 'none';
}

// ────────── カメラ映像の取得 ──────────

async function startCamera() {
  try {
    if (cameraVideo.srcObject) {
      cameraVideo.srcObject.getTracks().forEach((t) => t.stop());
      cameraVideo.srcObject = null;
    }

    const videoConstraints = {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    applyZoom(currentZoom);

    // プレビューコンテナのサイズに Three.js レンダラーを同期
    if (arScene) {
      arScene._handleResize();
    }

    return true;
  } catch (err) {
    console.error('カメラ取得失敗:', err);
    showToast('カメラへのアクセスに失敗しました。');
    return false;
  }
}

// ────────── ズーム倍率変更 (1x / 2x / 3x) ──────────

async function applyZoom(zoom) {
  currentZoom = zoom;
  if (zoomLabel) zoomLabel.textContent = `${zoom}x`;

  const track = cameraVideo.srcObject?.getVideoTracks()[0];
  let hwZoomApplied = false;
  if (track) {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.zoom) {
      try {
        const targetZoom = Math.min(Math.max(zoom, capabilities.zoom.min || 1), capabilities.zoom.max || 1);
        await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
        hwZoomApplied = true;
      } catch (err) {
        console.warn('ハードウェアズーム適用失敗:', err);
      }
    }
  }

  cameraVideo.classList.remove('zoomed-2x', 'zoomed-3x');
  if (!hwZoomApplied) {
    if (zoom === 2) {
      cameraVideo.classList.add('zoomed-2x');
    } else if (zoom === 3) {
      cameraVideo.classList.add('zoomed-3x');
    }
  }

  if (arScene) {
    arScene.setZoom(zoom);
  }
}

function toggleZoom() {
  const zoomCycle = [1, 2, 3];
  const nextIndex = (zoomCycle.indexOf(currentZoom) + 1) % zoomCycle.length;
  applyZoom(zoomCycle[nextIndex]);
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
    updateDashboardUI();
    updateFlagMarkerVisibility();
  });
  arCanvas.addEventListener('flag-deselected', () => {
    selectedFlagIndex = -1;
    updateDashboardUI();
    updateFlagMarkerVisibility();
  });

  // 旗移動・拡縮中の情報表示バッジ
  let transformHideTimer = null;
  arCanvas.addEventListener('flag-transform', (e) => {
    if (!flagTransformInfo) return;
    const { index, position, scale } = e.detail;
    if (transformHideTimer) {
      clearTimeout(transformHideTimer);
      transformHideTimer = null;
    }

    const flagNum = index + 1;
    const x = position.x.toFixed(2);
    const z = position.z.toFixed(2);
    const pct = Math.round(scale * 100);

    flagTransformInfo.textContent = `旗 ${flagNum} | 座標: X: ${x}m, Z: ${z}m | サイズ: ${pct}%`;
    flagTransformInfo.style.display = 'block';
    flagTransformInfo.style.opacity = '1';
  });

  arCanvas.addEventListener('flag-transform-end', () => {
    if (!flagTransformInfo) return;
    if (transformHideTimer) clearTimeout(transformHideTimer);
    transformHideTimer = setTimeout(() => {
      flagTransformInfo.style.opacity = '0';
      setTimeout(() => {
        if (flagTransformInfo.style.opacity === '0') {
          flagTransformInfo.style.display = 'none';
        }
      }, 200);
    }, 700);
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

  // 初期環境値を適用
  arScene.setWindAngle(THREE.MathUtils.degToRad(envSettings.windAngle));
  arScene.setWindStrength(envSettings.windStrength / 100);
  arScene.setLightAzimuth(THREE.MathUtils.degToRad((envSettings.lightAngle + 90) % 360));
  arScene.setLightIntensity((envSettings.lightStrength / 100) * 2.0);
  arScene.setLightColor(calcColorFromTemp(envSettings.lightColorTemp));
  arScene.setShadowOpacity(envSettings.shadowIntensity / 100);

  startScreen.style.display = 'none';
  arView.style.display = 'block';

  resetViewportToDefault();

  applyZoom(1);
  animate();

  updateDashboardUI();

  if (!gyroOk) {
    showToast('ジャイロセンサーが無効です。カメラ映像のみで動作します。');
  }
}

// ────────── UI イベントバインディング ──────────

function bindUIEvents() {
  startBtn.addEventListener('click', startApp);
  if (zoomToggleBtn) zoomToggleBtn.addEventListener('click', toggleZoom);

  window.addEventListener('resize', () => {
    if (!activeSettingKey) {
      resetViewportToDefault();
    }
  });

  // パネル開閉 (CSSのmax-height & opacityアコーディオンでアニメーション)
  panelHandle.addEventListener('click', () => {
    panelOpen = !panelOpen;
    controlPanel.classList.toggle('expanded', panelOpen);
    shutterBtn.disabled = panelOpen; // 展開中はシャッターボタンを無効化
    updateFlagMarkerVisibility();    // 選択旗▼マーカーの表示連動
    if (panelOpen) {
      updateDashboardUI();
    }
  });

  // 環境設定リセットボタン
  if (resetEnvSettingsBtn) {
    resetEnvSettingsBtn.addEventListener('click', resetEnvSettings);
  }

  // ダッシュボードタイルのタップイベント委譲
  panelExpanded.addEventListener('click', (e) => {
    const tile = e.target.closest('.dashboard-tile');
    if (!tile) return;
    const settingKey = tile.getAttribute('data-setting');
    if (settingKey) {
      openSingleSetting(settingKey);
    }
  });

  // 個別調整パネルのスライダー & ステップボタン
  singleSettingSlider.addEventListener('input', () => {
    const val = parseInt(singleSettingSlider.value, 10);
    if (activeSettingKey) {
      updateSingleSettingPreview(activeSettingKey, val);
    }
  });

  adjustMinusBtn.addEventListener('click', () => {
    if (!activeSettingKey) return;
    const step = parseInt(singleSettingSlider.step, 10) || 1;
    let val = parseInt(singleSettingSlider.value, 10) - step;
    if (val < parseInt(singleSettingSlider.min, 10)) {
      val = parseInt(singleSettingSlider.max, 10); // 循環
    }
    singleSettingSlider.value = val;
    updateSingleSettingPreview(activeSettingKey, val);
  });

  adjustPlusBtn.addEventListener('click', () => {
    if (!activeSettingKey) return;
    const step = parseInt(singleSettingSlider.step, 10) || 1;
    let val = parseInt(singleSettingSlider.value, 10) + step;
    if (val > parseInt(singleSettingSlider.max, 10)) {
      val = parseInt(singleSettingSlider.min, 10); // 循環
    }
    singleSettingSlider.value = val;
    updateSingleSettingPreview(activeSettingKey, val);
  });

  // カラーパレット
  singleSettingControlsColor.addEventListener('click', (e) => {
    const chip = e.target.closest('.btn-color-chip');
    if (!chip || !activeSettingKey) return;
    const color = chip.getAttribute('data-color');
    singleSettingColorPicker.value = color;
    updateSingleSettingPreview(activeSettingKey, color);
  });

  singleSettingColorPicker.addEventListener('input', () => {
    if (activeSettingKey) {
      updateSingleSettingPreview(activeSettingKey, singleSettingColorPicker.value);
    }
  });

  // 色温度スライダー & プリセットチップ
  if (singleSettingColorTempSlider) {
    singleSettingColorTempSlider.addEventListener('input', () => {
      const val = parseInt(singleSettingColorTempSlider.value, 10);
      if (activeSettingKey === 'lightColor') {
        updateSingleSettingPreview('lightColor', val);
      }
    });
  }

  if (singleSettingControlsColorTemp) {
    singleSettingControlsColorTemp.addEventListener('click', (e) => {
      const chip = e.target.closest('.btn-temp-chip');
      if (!chip || activeSettingKey !== 'lightColor') return;
      const temp = parseInt(chip.getAttribute('data-temp'), 10);
      if (singleSettingColorTempSlider) {
        singleSettingColorTempSlider.value = temp;
      }
      updateSingleSettingPreview('lightColor', temp);
    });
  }

  // 旗の反転トグルボタン (水平 / 垂直)
  if (flipHorizontalBtn) {
    flipHorizontalBtn.addEventListener('click', () => {
      if (selectedFlagIndex < 0 || !arScene?.flags[selectedFlagIndex]) return;
      const flag = arScene.flags[selectedFlagIndex];
      const newFlipH = !flag.flipH;
      flag.setFlip(newFlipH, flag.flipV);
      flipHorizontalBtn.classList.toggle('active', newFlipH);
      updateSingleSettingPreview('flagFlip', { flipH: newFlipH, flipV: flag.flipV });
    });
  }

  if (flipVerticalBtn) {
    flipVerticalBtn.addEventListener('click', () => {
      if (selectedFlagIndex < 0 || !arScene?.flags[selectedFlagIndex]) return;
      const flag = arScene.flags[selectedFlagIndex];
      const newFlipV = !flag.flipV;
      flag.setFlip(flag.flipH, newFlipV);
      flipVerticalBtn.classList.toggle('active', newFlipV);
      updateSingleSettingPreview('flagFlip', { flipH: flag.flipH, flipV: newFlipV });
    });
  }

  settingCancelBtn.addEventListener('click', cancelSingleSetting);
  settingConfirmBtn.addEventListener('click', confirmSingleSetting);

  // 旗切り替えパネルオープン
  if (switchFlagBtn) {
    switchFlagBtn.addEventListener('click', openSwitchFlagPanel);
  }

  // 旗切り替えアクション
  if (switchCancelBtn) {
    switchCancelBtn.addEventListener('click', closeSingleSetting);
  }

  if (switchSelectBtn) {
    switchSelectBtn.addEventListener('click', () => {
      if (pendingSwitchFlagIndex >= 0 && arScene?.flags[pendingSwitchFlagIndex]) {
        selectedFlagIndex = pendingSwitchFlagIndex;
        showToast(`旗 ${selectedFlagIndex + 1} に切り替えました`);
      }
      closeSingleSetting();
    });
  }

  if (switchApplyAndSelectBtn) {
    switchApplyAndSelectBtn.addEventListener('click', () => {
      if (
        pendingSwitchFlagIndex >= 0 &&
        selectedFlagIndex >= 0 &&
        pendingSwitchFlagIndex !== selectedFlagIndex &&
        arScene?.flags[pendingSwitchFlagIndex] &&
        arScene?.flags[selectedFlagIndex]
      ) {
        const src = arScene.flags[selectedFlagIndex];
        const dst = arScene.flags[pendingSwitchFlagIndex];

        // 現在の旗の設定を新しい旗に適用
        dst.setRotationY(src.rotationY);
        dst.setFlip(src.flipH, src.flipV);
        dst.setOpacity(src.opacity);
        dst.setPoleColor(src.poleColor);
        dst.setStandColor(src.standColor);

        selectedFlagIndex = pendingSwitchFlagIndex;
        showToast(`同じ設定を適用して旗 ${selectedFlagIndex + 1} に切り替えました`);
      } else if (pendingSwitchFlagIndex >= 0) {
        selectedFlagIndex = pendingSwitchFlagIndex;
      }
      closeSingleSetting();
    });
  }

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

      flag.group.traverse((child) => {
        if (child.isMesh) touchControls.addTarget(child);
      });

      selectedFlagIndex = index;
      updateFlagCount();
      updateDashboardUI();
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
      updateDashboardUI();
      updateFlagMarkerVisibility();
      showToast('のぼり旗を削除しました。');
    }
  });

  // シャッター（写真一時保存）
  shutterBtn.addEventListener('click', async () => {
    if (!arScene) return;

    shutterBtn.disabled = true;
    shutterBtn.classList.add('capturing');

    try {
      const blob = await captureComposite(cameraVideo, arScene.renderer, currentZoom);
      const url = URL.createObjectURL(blob);

      capturedPhotos.unshift({
        blob,
        url,
        timestamp: Date.now(),
      });

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

  downloadModalBtn.addEventListener('click', () => {
    if (capturedPhotos.length === 0 || !capturedPhotos[currentPhotoIndex]) return;
    const photo = capturedPhotos[currentPhotoIndex];
    downloadBlob(photo.blob, `ar-banner-flag-${photo.timestamp}.png`);
    showToast('画像を端末にダウンロードしました');
  });

  deletePhotoBtn.addEventListener('click', () => {
    if (capturedPhotos.length === 0 || !capturedPhotos[currentPhotoIndex]) return;
    const removed = capturedPhotos.splice(currentPhotoIndex, 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    updateGalleryBadge();
    renderGalleryModal();
    showToast('写真を削除しました');
  });

  // トップページに戻る処理
  function exitToHome() {
    if (cameraVideo.srcObject) {
      cameraVideo.srcObject.getTracks().forEach((track) => track.stop());
      cameraVideo.srcObject = null;
    }

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    // 撮影した写真を解放 & クリア
    capturedPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
    capturedPhotos.length = 0;
    updateGalleryBadge();

    arScene?.setWindVisualizer(false);
    arScene?.setSelectedFlagMarker(null, false);
    arScene?.flags?.forEach((f) => f.setDimmed(false));

    if (cameraViewport) {
      cameraViewport.style.setProperty('--shift-y', '0px');
    }

    panelOpen = false;
    shutterBtn.disabled = false;
    controlPanel.classList.remove('expanded');
    controlPanel.classList.remove('panel-hidden');
    singleSettingPanel.classList.remove('panel-active');
    singleSettingPanel.style.display = 'none';
    controlPanel.style.display = 'block';

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
  }

  if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', () => {
      // 撮影写真がある場合は確認モーダルを表示
      if (capturedPhotos.length > 0) {
        if (confirmLeavePhotoCount) {
          confirmLeavePhotoCount.textContent = capturedPhotos.length;
        }
        if (confirmLeaveModal) {
          confirmLeaveModal.style.display = 'flex';
        }
      } else {
        exitToHome();
      }
    });
  }

  // 確認モーダルのボタン
  if (confirmLeaveOkBtn) {
    confirmLeaveOkBtn.addEventListener('click', () => {
      if (confirmLeaveModal) confirmLeaveModal.style.display = 'none';
      exitToHome();
    });
  }

  if (confirmLeaveCancelBtn) {
    confirmLeaveCancelBtn.addEventListener('click', () => {
      if (confirmLeaveModal) confirmLeaveModal.style.display = 'none';
    });
  }

  if (confirmLeaveModal) {
    confirmLeaveModal.addEventListener('click', (e) => {
      if (e.target === confirmLeaveModal) {
        confirmLeaveModal.style.display = 'none';
      }
    });
  }
}

// ────────── 初期化 ──────────

document.addEventListener('DOMContentLoaded', () => {
  bindUIEvents();
  updateFlagCount();
  updateGalleryBadge();
});
