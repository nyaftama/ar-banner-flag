/**
 * banner-flag.js
 * のぼり旗3Dオブジェクト（旗メッシュ + ポール + スタンド）
 */

import { createWindMaterial } from './wind-shader.js?v=0.90';

/** のぼり旗の基準定数 */
const FLAG_BASE_HEIGHT = 1.8; // 基準の高さ 180cm
const FLAG_SEGMENTS_W = 20;
const FLAG_SEGMENTS_H = 30;

const POLE_RADIUS = 0.015;
const CROSSBAR_RADIUS = 0.01;

const STAND_BASE_RADIUS = 0.18;
const STAND_BASE_HEIGHT = 0.04;
const STAND_PIPE_RADIUS = 0.025;
const STAND_PIPE_HEIGHT = 0.15;

export class BannerFlag {
  /**
   * @param {number} index - 旗のインデックス (0〜2)
   */
  constructor(index) {
    /** @type {THREE.Group} */
    this.group = new THREE.Group();
    this.group.userData.isBannerFlag = true;
    this.group.userData.flagIndex = index;

    this._opacity = 0.90; // デフォルト90%
    this._flagWidth = 0.6;
    this._flagHeight = 1.8;
    this.thumbnailUrl = '';

    /** @type {THREE.ShaderMaterial|null} */
    this._flagMaterial = null;
    /** @type {THREE.Mesh|null} */
    this._flagMesh = null;
    /** @type {THREE.Group|null} */
    this._poleGroup = null;

    /** @type {THREE.MeshStandardMaterial} */
    this._poleMaterial = new THREE.MeshStandardMaterial({
      color: 0xC0C0C0,
      metalness: 0.6,
      roughness: 0.3,
    });
    /** @type {THREE.MeshStandardMaterial} */
    this._standMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.4,
      roughness: 0.5,
    });

    this._buildPole(this._flagWidth, this._flagHeight);
    this._buildStand();
  }

  /**
   * 旗画像テクスチャを読み込み、アスペクト比を維持して旗メッシュとポールを生成
   * @param {string} imageUrl - data URL または object URL
   * @returns {Promise<void>}
   */
  loadFlagTexture(imageUrl) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        imageUrl,
        (texture) => {
          if (THREE.SRGBColorSpace) {
            texture.colorSpace = THREE.SRGBColorSpace;
          } else if (THREE.sRGBEncoding) {
            texture.encoding = THREE.sRGBEncoding;
          }

          // ── 画像のアスペクト比（width / height）を取得してサイズ計算 ──
          const img = texture.image;
          const imgW = img?.naturalWidth || img?.width || 600;
          const imgH = img?.naturalHeight || img?.height || 1800;
          const aspect = imgW / imgH;

          // 基本は高さ1.8m基準でアスペクト比を保つ
          let flagHeight = FLAG_BASE_HEIGHT;
          let flagWidth = flagHeight * aspect;

          // 横長すぎる場合は幅を最大1.2mにクランプ
          if (flagWidth > 1.2) {
            flagWidth = 1.2;
            flagHeight = flagWidth / aspect;
          }
          // 細すぎる場合の最小幅制限
          if (flagWidth < 0.25) {
            flagWidth = 0.25;
            flagHeight = flagWidth / aspect;
          }

          this._flagWidth = flagWidth;
          this._flagHeight = flagHeight;

          // サムネイル用データURLを生成・保持
          try {
            const thumbCanvas = document.createElement('canvas');
            const thumbW = 90;
            const thumbH = Math.round(thumbW / aspect);
            thumbCanvas.width = thumbW;
            thumbCanvas.height = Math.min(thumbH, 200);
            const ctx = thumbCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
            this.thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);
          } catch (e) {
            this.thumbnailUrl = imageUrl;
          }

          // ポールを旗サイズに合わせて再構築
          this._buildPole(flagWidth, flagHeight);
          // 旗メッシュを生成
          this._buildFlagMesh(texture, flagWidth, flagHeight);

          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  // ────────── 不透明度 ──────────

  /** @param {number} val - 0〜1 (例: 0.95) */
  setOpacity(val) {
    this._opacity = val;
    if (this._flagMaterial) {
      this._flagMaterial.uniforms.uOpacity.value = val;
    }
  }

  get opacity() {
    return this._opacity;
  }

  // ────────── ポール / スタンドの色変更 ──────────

  /** @param {string} hexColor - 例: "#C0C0C0" */
  setPoleColor(hexColor) {
    this._poleMaterial.color.set(hexColor);
  }

  /** @param {string} hexColor - 例: "#333333" */
  setStandColor(hexColor) {
    this._standMaterial.color.set(hexColor);
  }

  get poleColor() {
    return '#' + this._poleMaterial.color.getHexString();
  }

  get standColor() {
    return '#' + this._standMaterial.color.getHexString();
  }

  // ────────── 向き（Y軸回転） ──────────

  /** @param {number} rad - ラジアン (0〜2π) */
  setRotationY(rad) {
    this.group.rotation.y = rad;
  }

  get rotationY() {
    return this.group.rotation.y;
  }

  // ────────── 風パラメータ更新 ──────────

  /**
   * @param {number} strength - 0〜1
   * @param {number} angle - ラジアン
   * @param {number} time - 経過秒数
   */
  updateWind(strength, angle, time) {
    if (this._flagMaterial) {
      this._flagMaterial.uniforms.uWindStrength.value = strength;
      this._flagMaterial.uniforms.uWindAngle.value = angle;
      this._flagMaterial.uniforms.uTime.value = time;
    }
  }

  /**
   * ライティング方向、強度、光色を設定
   * @param {THREE.Vector3} dir
   * @param {number} intensity
   * @param {THREE.Color} [color]
   */
  updateLighting(dir, intensity, color) {
    if (this._flagMaterial) {
      this._flagMaterial.uniforms.uLightDir.value.copy(dir);
      this._flagMaterial.uniforms.uLightIntensity.value = intensity;
      if (color && this._flagMaterial.uniforms.uLightColor) {
        this._flagMaterial.uniforms.uLightColor.value.copy(color);
      }
    }
  }

  // ────────── 3Dオブジェクト構築 (Private) ──────────

  /** 旗メッシュ (ShaderMaterial) */
  _buildFlagMesh(texture, width, height) {
    if (this._flagMesh) {
      this.group.remove(this._flagMesh);
      this._flagMesh.geometry.dispose();
      if (this._flagMaterial) this._flagMaterial.dispose();
    }

    const geo = new THREE.PlaneGeometry(
      width, height,
      FLAG_SEGMENTS_W, FLAG_SEGMENTS_H
    );

    this._flagMaterial = createWindMaterial(texture, this._opacity);
    this._flagMesh = new THREE.Mesh(geo, this._flagMaterial);
    this._flagMesh.castShadow = true;

    // 旗の位置: ポール上端付近から垂れ下がる形
    const poleHeight = height + 0.35;
    const flagTopY = poleHeight - 0.05;
    this._flagMesh.position.set(
      width / 2 + POLE_RADIUS, // ポールの右側に旗が展開
      flagTopY - height / 2,   // 上辺がポール上端付近
      0
    );

    this.group.add(this._flagMesh);
  }

  /** ポール (垂直の柱 + 上部の横棒) */
  _buildPole(width, height) {
    if (this._poleGroup) {
      this.group.remove(this._poleGroup);
      this._poleGroup.traverse((c) => {
        if (c.isMesh) c.geometry.dispose();
      });
    }

    this._poleGroup = new THREE.Group();

    const poleHeight = height + 0.35;
    const crossbarLength = width + 0.04;

    // 垂直ポール
    const poleGeo = new THREE.CylinderGeometry(
      POLE_RADIUS, POLE_RADIUS, poleHeight, 12
    );
    const poleMesh = new THREE.Mesh(poleGeo, this._poleMaterial);
    poleMesh.position.set(0, poleHeight / 2, 0);
    poleMesh.castShadow = true;
    this._poleGroup.add(poleMesh);

    // 横棒 (クロスバー)
    const crossbarGeo = new THREE.CylinderGeometry(
      CROSSBAR_RADIUS, CROSSBAR_RADIUS, crossbarLength, 8
    );
    const crossbarMesh = new THREE.Mesh(crossbarGeo, this._poleMaterial);
    crossbarMesh.rotation.z = Math.PI / 2; // 横向きに回転
    crossbarMesh.position.set(
      crossbarLength / 2,
      poleHeight - 0.02,
      0
    );
    crossbarMesh.castShadow = true;
    this._poleGroup.add(crossbarMesh);

    // ポール上端のキャップ（球）
    const capGeo = new THREE.SphereGeometry(POLE_RADIUS * 1.4, 8, 8);
    const capMesh = new THREE.Mesh(capGeo, this._poleMaterial);
    capMesh.position.set(0, poleHeight, 0);
    this._poleGroup.add(capMesh);

    this.group.add(this._poleGroup);
  }

  /** スタンド (台座) */
  _buildStand() {
    // 円形ベース
    const baseGeo = new THREE.CylinderGeometry(
      STAND_BASE_RADIUS, STAND_BASE_RADIUS * 1.1, STAND_BASE_HEIGHT, 24
    );
    const baseMesh = new THREE.Mesh(baseGeo, this._standMaterial);
    baseMesh.position.set(0, STAND_BASE_HEIGHT / 2, 0);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    this.group.add(baseMesh);

    // 接続パイプ
    const pipeGeo = new THREE.CylinderGeometry(
      STAND_PIPE_RADIUS, STAND_PIPE_RADIUS, STAND_PIPE_HEIGHT, 12
    );
    const pipeMesh = new THREE.Mesh(pipeGeo, this._standMaterial);
    pipeMesh.position.set(0, STAND_BASE_HEIGHT + STAND_PIPE_HEIGHT / 2, 0);
    pipeMesh.castShadow = true;
    this.group.add(pipeMesh);

    // リング装飾 (トーラス)
    const ringGeo = new THREE.TorusGeometry(STAND_BASE_RADIUS * 0.85, 0.008, 8, 32);
    const ringMesh = new THREE.Mesh(ringGeo, this._standMaterial);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.set(0, STAND_BASE_HEIGHT, 0);
    this.group.add(ringMesh);
  }

  /** リソース解放 */
  dispose() {
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material.dispose) child.material.dispose();
        if (child.material.uniforms && child.material.uniforms.uTexture) {
          child.material.uniforms.uTexture.value?.dispose();
        }
      }
    });
  }
}
