/**
 * ar-scene.js
 * Three.js シーン構築、カメラ・ジャイロ連動、ライティング、レンダリングループ
 */

import { BannerFlag } from './banner-flag.js';

export class ARScene {
  /**
   * @param {HTMLCanvasElement} canvas - WebGL 描画先 Canvas
   * @param {HTMLVideoElement} video - カメラ映像の video 要素
   */
  constructor(canvas, video) {
    this._canvas = canvas;
    this._video = video;

    /** @type {BannerFlag[]} */
    this._flags = [];
    this._clock = new THREE.Clock();

    // ── デバイス方向 ──
    this._deviceAlpha = 0;
    this._deviceBeta = 0;
    this._deviceGamma = 0;
    this._screenOrientation = 0;
    this._orientationEnabled = false;

    // ── 風パラメータ ──
    this._windStrength = 0.3;
    this._windAngle = Math.PI * 0.5;

    // ── ライトパラメータ ──
    this._lightAzimuth = Math.PI / 4;  // 水平角
    this._lightElevation = Math.PI / 4; // 仰角
    this._lightIntensity = 1.0;
    this._shadowOpacity = 0.4;

    this._initScene();
    this._initCamera();
    this._initRenderer();
    this._initLighting();
    this._initGroundPlane();
    this._setupOrientationListener();
    this._handleResize();

    window.addEventListener('resize', () => this._handleResize());
  }

  // ────────── Public API ──────────

  /** @returns {THREE.Scene} */
  get scene() { return this._scene; }

  /** @returns {THREE.PerspectiveCamera} */
  get camera() { return this._camera; }

  /** @returns {THREE.WebGLRenderer} */
  get renderer() { return this._renderer; }

  /** @returns {BannerFlag[]} */
  get flags() { return this._flags; }

  get orientationEnabled() { return this._orientationEnabled; }

  /**
   * のぼり旗を追加し、カメラ正面に配置する
   * @param {BannerFlag} flag
   */
  addFlag(flag) {
    // カメラの正面方向 3m 先に配置
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this._camera.quaternion);
    const pos = this._camera.position.clone().addScaledVector(dir, 3);
    pos.y = 0; // 地面レベル

    flag.group.position.copy(pos);
    this._scene.add(flag.group);
    this._flags.push(flag);
  }

  /**
   * のぼり旗を削除
   * @param {number} index
   */
  removeFlag(index) {
    if (index >= 0 && index < this._flags.length) {
      const flag = this._flags[index];
      this._scene.remove(flag.group);
      flag.dispose();
      this._flags.splice(index, 1);
      // インデックスを再採番
      this._flags.forEach((f, i) => {
        f.group.userData.flagIndex = i;
      });
    }
  }

  // ── 風パラメータ ──

  setWindStrength(val) {
    this._windStrength = val;
  }
  setWindAngle(rad) {
    this._windAngle = rad;
  }

  // ── ライティングパラメータ ──

  setLightAzimuth(rad) {
    this._lightAzimuth = rad;
    this._updateLightPosition();
  }
  setLightElevation(rad) {
    this._lightElevation = rad;
    this._updateLightPosition();
  }
  setLightIntensity(val) {
    this._lightIntensity = val;
    this._dirLight.intensity = val;
  }
  setShadowOpacity(val) {
    this._shadowOpacity = val;
    if (this._groundMaterial) {
      this._groundMaterial.opacity = val;
    }
  }

  /** 1フレーム描画 */
  render() {
    const elapsed = this._clock.getElapsedTime();

    // ジャイロ → カメラ回転
    if (this._orientationEnabled) {
      this._applyDeviceOrientation();
    }

    // ライト方向ベクトル（シェーダー用）
    const lightDir = this._dirLight.position.clone().normalize();

    // 各旗の風 & ライト更新
    for (const flag of this._flags) {
      flag.updateWind(this._windStrength, this._windAngle, elapsed);
      flag.updateLighting(lightDir, this._lightIntensity);
    }

    this._renderer.render(this._scene, this._camera);
  }

  // ────────── Private: 初期化 ──────────

  _initScene() {
    this._scene = new THREE.Scene();
  }

  _initCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this._camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this._camera.position.set(0, 1.5, 0); // 目の高さ
  }

  _initRenderer() {
    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,              // 背景透過（カメラ映像が見えるように）
      antialias: true,
      preserveDrawingBuffer: true, // キャプチャ用に必要
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initLighting() {
    // 環境光
    this._ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this._scene.add(this._ambientLight);

    // 指向性ライト (影付き)
    this._dirLight = new THREE.DirectionalLight(0xffffff, this._lightIntensity);
    this._dirLight.castShadow = true;
    this._dirLight.shadow.mapSize.width = 1024;
    this._dirLight.shadow.mapSize.height = 1024;
    this._dirLight.shadow.camera.near = 0.1;
    this._dirLight.shadow.camera.far = 20;
    this._dirLight.shadow.camera.left = -5;
    this._dirLight.shadow.camera.right = 5;
    this._dirLight.shadow.camera.top = 5;
    this._dirLight.shadow.camera.bottom = -5;
    this._dirLight.shadow.bias = -0.002;
    this._scene.add(this._dirLight);

    this._updateLightPosition();
  }

  _initGroundPlane() {
    // 影を受ける透明な地面 (ShadowMaterial は影だけを描画)
    this._groundMaterial = new THREE.ShadowMaterial({ opacity: this._shadowOpacity });
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    this._groundMesh = new THREE.Mesh(groundGeo, this._groundMaterial);
    this._groundMesh.rotation.x = -Math.PI / 2;
    this._groundMesh.position.y = 0;
    this._groundMesh.receiveShadow = true;
    this._scene.add(this._groundMesh);
  }

  _updateLightPosition() {
    const dist = 8;
    const x = Math.cos(this._lightAzimuth) * Math.cos(this._lightElevation) * dist;
    const y = Math.sin(this._lightElevation) * dist;
    const z = Math.sin(this._lightAzimuth) * Math.cos(this._lightElevation) * dist;
    this._dirLight.position.set(x, y, z);
    this._dirLight.target.position.set(0, 0, 0);
  }

  // ────────── Private: デバイスオリエンテーション ──────────

  _setupOrientationListener() {
    this._onOrientation = (e) => {
      if (e.alpha !== null) {
        this._deviceAlpha = THREE.MathUtils.degToRad(e.alpha);
        this._deviceBeta = THREE.MathUtils.degToRad(e.beta);
        this._deviceGamma = THREE.MathUtils.degToRad(e.gamma);
        this._orientationEnabled = true;
      }
    };

    this._onOrientationChange = () => {
      this._screenOrientation = THREE.MathUtils.degToRad(
        window.screen.orientation?.angle || window.orientation || 0
      );
    };

    window.addEventListener('deviceorientation', this._onOrientation, true);
    window.addEventListener('orientationchange', this._onOrientationChange, false);
    this._onOrientationChange();
  }

  /**
   * デバイスの方向をカメラの回転に変換
   * Three.js 旧 DeviceOrientationControls のアルゴリズムを流用
   */
  _applyDeviceOrientation() {
    const alpha = this._deviceAlpha;
    const beta = this._deviceBeta;
    const gamma = this._deviceGamma;
    const orient = this._screenOrientation;

    // オイラー角 → クォータニオン変換
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X
    const zee = new THREE.Vector3(0, 0, 1);

    euler.set(beta, alpha, -gamma, 'YXZ');
    this._camera.quaternion.setFromEuler(euler);
    this._camera.quaternion.multiply(q1);
    this._camera.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
  }

  _handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  /** リソース解放 */
  dispose() {
    window.removeEventListener('deviceorientation', this._onOrientation, true);
    window.removeEventListener('orientationchange', this._onOrientationChange, false);
    window.removeEventListener('resize', this._handleResize);
    this._renderer.dispose();
    for (const f of this._flags) f.dispose();
  }
}
