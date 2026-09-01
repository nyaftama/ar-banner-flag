/**
 * capture.js
 * カメラ映像 + WebGL Canvas を合成して画像保存するシャッター機能
 */

/**
 * カメラ映像と3Dシーンを1枚の画像に合成し、Blobを返す
 * @param {HTMLVideoElement} video - カメラ映像の video 要素
 * @param {THREE.WebGLRenderer} renderer - Three.js レンダラー
 * @param {number} [zoom=1] - ズーム倍率 (1 または 2)
 * @returns {Promise<Blob>}
 */
export async function captureComposite(video, renderer, zoom = 1) {
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;

  // オフスクリーン Canvas で合成
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext('2d');

  // 1) 背景: カメラ映像を描画（アスペクト比を維持して中央にフィット＆ズームクロップ）
  const videoAspect = video.videoWidth / video.videoHeight;
  const canvasAspect = width / height;

  let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
  if (videoAspect > canvasAspect) {
    // ビデオが横長 → 左右をクロップ
    sw = video.videoHeight * canvasAspect;
    sx = (video.videoWidth - sw) / 2;
  } else {
    // ビデオが縦長 → 上下をクロップ
    sh = video.videoWidth / canvasAspect;
    sy = (video.videoHeight - sh) / 2;
  }

  // ズーム適用 (中央からクロップ)
  if (zoom > 1) {
    const croppedW = sw / zoom;
    const croppedH = sh / zoom;
    sx += (sw - croppedW) / 2;
    sy += (sh - croppedH) / 2;
    sw = croppedW;
    sh = croppedH;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

  // 2) 前景: WebGL Canvas を重ねて描画
  ctx.drawImage(renderer.domElement, 0, 0, width, height);

  // 3) Blob として返す
  return new Promise((resolve, reject) => {
    offscreen.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('画像の合成に失敗しました'));
      }
    }, 'image/png');
  });
}

/**
 * Blob を PNG ファイルとしてダウンロードさせる
 * @param {Blob} blob - 画像 Blob
 * @param {string} [filename] - ファイル名
 */
export function downloadBlob(blob, filename) {
  if (!filename) {
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    filename = `ar-banner-flag_${ts}.png`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // メモリ解放を少し遅延させる（iOS Safari 対策）
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
