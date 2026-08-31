/**
 * banner-flag.js
 * のぼり旗3Dオブジェクト生成
 * 「旗メッシュ + ポール + スタンド」を1セットとして管理する
 */

import { createWindMaterial } from './wind-shader.js';

/** のぼり旗の定数 */
const FLAG_WIDTH = 0.6;   // 60cm
const FLAG_HEIGHT = 1.8;  // 180cm  (1:3 比率)
const FLAG_SEGMENTS_W = 20;
const FLAG_SEGMENTS_H = 30;

const POLE_RADIUS = 0.015;
const POLE_HEIGHT = 2.2;  // 旗より少し上に突き出す
const CROSSBAR_LENGTH = FLAG_WIDTH + 0.04;
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

    /** @type {THREE.ShaderMaterial|null} */
    this._flagMaterial = null;
    /** @type {THREE.Mesh|null} */
    this._flagMesh = null;
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

    this._buildPole();
    this._buildStand();
  }

  /**
   * 旗画像テクスチャを読み込み、旗メッシュを生成してグループに追加する
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
          this._buildFlagMesh(texture);
          resolve();
        },
        undefined,
        (err) => reject(err)
      );
    });
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
   * ライティング方向と強度を設定
   * @param {THREE.Vector3} dir
   * @param {number} intensity
   */
  updateLighting(dir, intensity) {
    if (this._flagMaterial) {
      this._flagMaterial.uniforms.uLightDir.value.copy(dir);
      this._flagMaterial.uniforms.uLightIntensity.value = intensity;
    }
  }

  // ────────── 3Dオブジェクト構築 (Private) ──────────

  /** 旗メッシュ (ShaderMaterial) */
  _buildFlagMesh(texture) {
    // 既存の旗メッシュがあれば除去
    if (this._flagMesh) {
      this.group.remove(this._flagMesh);
      this._flagMesh.geometry.dispose();
      if (this._flagMaterial) this._flagMaterial.dispose();
    }

    const geo = new THREE.PlaneGeometry(
      FLAG_WIDTH, FLAG_HEIGHT,
      FLAG_SEGMENTS_W, FLAG_SEGMENTS_H
    );

    this._flagMaterial = createWindMaterial(texture);
    this._flagMesh = new THREE.Mesh(geo, this._flagMaterial);
    this._flagMesh.castShadow = true;

    // 旗の位置: ポール上端付近から垂れ下がる形
    // PlaneGeometry の中心が (0,0,0) なので、
    // 上辺がポール上端の高さに来るように配置
    const flagTopY = POLE_HEIGHT - 0.05;
    this._flagMesh.position.set(
      FLAG_WIDTH / 2 + POLE_RADIUS, // ポールの右側に旗が展開
      flagTopY - FLAG_HEIGHT / 2,   // 上辺がポール上端付近
      0
    );

    this.group.add(this._flagMesh);
  }

  /** ポール (垂直の柱 + 上部の横棒) */
  _buildPole() {
    // 垂直ポール
    const poleGeo = new THREE.CylinderGeometry(
      POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 12
    );
    const poleMesh = new THREE.Mesh(poleGeo, this._poleMaterial);
    poleMesh.position.set(0, POLE_HEIGHT / 2, 0);
    poleMesh.castShadow = true;
    this.group.add(poleMesh);

    // 横棒 (クロスバー)
    const crossbarGeo = new THREE.CylinderGeometry(
      CROSSBAR_RADIUS, CROSSBAR_RADIUS, CROSSBAR_LENGTH, 8
    );
    const crossbarMesh = new THREE.Mesh(crossbarGeo, this._poleMaterial);
    crossbarMesh.rotation.z = Math.PI / 2; // 横向きに回転
    crossbarMesh.position.set(
      CROSSBAR_LENGTH / 2,
      POLE_HEIGHT - 0.02,
      0
    );
    crossbarMesh.castShadow = true;
    this.group.add(crossbarMesh);

    // ポール上端のキャップ（球）
    const capGeo = new THREE.SphereGeometry(POLE_RADIUS * 1.5, 8, 8);
    const capMesh = new THREE.Mesh(capGeo, this._poleMaterial);
    capMesh.position.set(0, POLE_HEIGHT, 0);
    this.group.add(capMesh);
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
