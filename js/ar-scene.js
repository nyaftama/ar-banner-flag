/**
 * ar-scene.js
 * Three.js シーン構築、カメラ・ジャイロ連動、ライティング、レンダリングループ
 */

import { BannerFlag } from './banner-flag.js?v=0.90';

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
    this._lightIntensity = 2.0;
    this._lightColor = new THREE.Color(0xffffff);
    this._shadowOpacity = 0.15;

    this._initScene();
    this._initCamera();
    this._initRenderer();
    this._initLighting();
    this._initGroundPlane();
    this._initWindVisualizer();
    this._initFlagIndicatorMarker();
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
  setLightColor(colorHexOrColor) {
    this._lightColor.set(colorHexOrColor);
    if (this._dirLight) {
      this._dirLight.color.copy(this._lightColor);
    }
    if (this._ambientLight) {
      this._ambientLight.color.copy(this._lightColor);
    }
  }
  setShadowOpacity(val) {
    this._shadowOpacity = val;
    if (this._groundMaterial) {
      this._groundMaterial.opacity = val;
    }
  }

  /**
   * カメラのズーム倍率を設定 (1x / 2x)
   * @param {number} zoomFactor - 1 または 2
   */
  setZoom(zoomFactor = 1) {
    if (!this._camera) return;
    this._camera.fov = this._baseFov / zoomFactor;
    this._camera.updateProjectionMatrix();
  }

  /**
   * 風向き可視化エフェクトの表示/非表示
   * @param {boolean} visible
   */
  setWindVisualizer(visible) {
    if (this._windVisualizerGroup) {
      this._windVisualizerGroup.visible = visible;
    }
  }

  /**
   * 旗の上に表示する▼マーカーの制御
   * @param {BannerFlag|null} flag - メイン（不透明）マーカー対象
   * @param {boolean} visible - メイン表示フラグ
   * @param {BannerFlag|null} [secondaryFlag] - サブ（半透明）マーカー対象
   * @param {boolean} [secondaryVisible] - サブ表示フラグ
   */
  setSelectedFlagMarker(flag, visible, secondaryFlag = null, secondaryVisible = false) {
    this._selectedFlagForMarker = visible ? flag : null;
    if (this._flagMarker) {
      this._flagMarker.visible = visible && !!flag;
    }

    this._secondaryFlagForMarker = secondaryVisible ? secondaryFlag : null;
    if (this._flagMarkerSecondary) {
      this._flagMarkerSecondary.visible = secondaryVisible && !!secondaryFlag;
    }
  }

  /** 1フレーム描画 */
  render() {
    const elapsed = this._clock.getElapsedTime();
    const delta = this._clock.getDelta() || 0.016;

    // ジャイロ → カメラ回転
    if (this._orientationEnabled) {
      this._applyDeviceOrientation();
    }

    // 風可視化エフェクトの更新
    this._updateWindVisualizer(delta);

    // 選択旗▼マーカーの更新
    this._updateFlagIndicatorMarker(elapsed);

    // ライト方向ベクトル（シェーダー用）
    const lightDir = this._dirLight.position.clone().normalize();

    // 各旗の風 & ライト更新
    for (const flag of this._flags) {
      flag.updateWind(this._windStrength, this._windAngle, elapsed);
      flag.updateLighting(lightDir, this._lightIntensity, this._lightColor);
    }

    this._renderer.render(this._scene, this._camera);
  }

  // ────────── Private: 初期化 ──────────

  _initScene() {
    this._scene = new THREE.Scene();
  }

  _initCamera() {
    this._baseFov = 60;
    const aspect = window.innerWidth / window.innerHeight;
    this._camera = new THREE.PerspectiveCamera(this._baseFov, aspect, 0.1, 1000);
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
    if (THREE.SRGBColorSpace) {
      this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (THREE.sRGBEncoding) {
      this._renderer.outputEncoding = THREE.sRGBEncoding;
    }
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

  // ────────── Private: 風の可視化エフェクト ──────────

  _initWindVisualizer() {
    this._windVisualizerGroup = new THREE.Group();
    this._windVisualizerGroup.visible = false;
    this._scene.add(this._windVisualizerGroup);

    // 1. 風の流線 (LineSegments)
    const lineCount = 36;
    const positions = new Float32Array(lineCount * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x81c784, // 淡いグリーン
      transparent: true,
      opacity: 0.8,
      linewidth: 2,
    });

    this._windLinesMesh = new THREE.LineSegments(geometry, material);
    this._windVisualizerGroup.add(this._windLinesMesh);

    // 各ストロークの初期データ
    this._windParticles = [];
    for (let i = 0; i < lineCount; i++) {
      this._windParticles.push({
        x: (Math.random() - 0.5) * 3.5,
        y: 0.2 + Math.random() * 2.2,
        z: (Math.random() - 0.5) * 3.5,
        speed: 1.2 + Math.random() * 1.6,
        length: 0.4 + Math.random() * 0.35,
      });
    }
  }

  _updateWindVisualizer(delta) {
    if (!this._windVisualizerGroup || !this._windVisualizerGroup.visible) return;

    // 中心位置を旗の近くに合わせる
    let centerX = 0;
    let centerZ = -2.5;
    if (this._flags.length > 0) {
      const flag = this._flags[0];
      centerX = flag.group.position.x;
      centerZ = flag.group.position.z;
    }
    this._windVisualizerGroup.position.set(centerX, 0, centerZ);

    // 吹く先の方向ベクトル (0°=奥-Z, 90°=右+X, 180°=手前+Z, 270°=左-X)
    const dirX = Math.sin(this._windAngle);
    const dirZ = -Math.cos(this._windAngle);

    // 流線の更新
    const positions = this._windLinesMesh.geometry.attributes.position.array;
    const speedMult = 1.0 + this._windStrength * 3.5;

    for (let i = 0; i < this._windParticles.length; i++) {
      const p = this._windParticles[i];
      const moveDist = p.speed * speedMult * delta;

      p.x += dirX * moveDist;
      p.z += dirZ * moveDist;

      // 範囲チェック (中心から半径2mを超えたら風上側へ戻す)
      const distSq = p.x * p.x + p.z * p.z;
      if (distSq > 5.0 || Math.abs(p.x) > 2.2 || Math.abs(p.z) > 2.2) {
        // 風上（-dirX, -dirZ）側から再スポーン
        const sideOffset = (Math.random() - 0.5) * 2.8;
        const perpX = -dirZ;
        const perpZ = dirX;

        p.x = -dirX * 1.9 + perpX * sideOffset;
        p.z = -dirZ * 1.9 + perpZ * sideOffset;
        p.y = 0.2 + Math.random() * 2.2;
      }

      // 頂点座標のセット
      const idx = i * 6;
      positions[idx] = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = p.z;

      positions[idx + 3] = p.x - dirX * p.length;
      positions[idx + 4] = p.y;
      positions[idx + 5] = p.z - dirZ * p.length;
    }

    this._windLinesMesh.geometry.attributes.position.needsUpdate = true;
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

  _initFlagIndicatorMarker() {
    // 逆四角錐（下を向く角錐ピラミッド）
    const coneGeo = new THREE.ConeGeometry(0.18, 0.175, 4);
    coneGeo.rotateX(Math.PI);
    coneGeo.rotateY(Math.PI / 4);

    // メインマーカー (不透明)
    this._flagMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd600,
      transparent: false,
      depthTest: false,
    });
    this._flagMarker = new THREE.Mesh(coneGeo, this._flagMarkerMaterial);
    this._flagMarker.renderOrder = 999;
    this._flagMarker.visible = false;
    this._scene.add(this._flagMarker);

    // セカンダリマーカー (半透明)
    this._flagMarkerSecondaryMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd600,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
    });
    this._flagMarkerSecondary = new THREE.Mesh(coneGeo, this._flagMarkerSecondaryMaterial);
    this._flagMarkerSecondary.renderOrder = 998;
    this._flagMarkerSecondary.visible = false;
    this._scene.add(this._flagMarkerSecondary);

    this._selectedFlagForMarker = null;
    this._secondaryFlagForMarker = null;
  }

  _updateFlagIndicatorMarker(elapsed) {
    const floatSin = Math.sin(elapsed * 4.0) * 0.05;
    const rotY = elapsed * 1.5;

    // メインマーカー (不透明)
    if (this._flagMarker && this._flagMarker.visible && this._selectedFlagForMarker) {
      const group = this._selectedFlagForMarker.group;
      if (group) {
        const scale = group.scale.x;
        const baseY = 3.0 * scale;
        this._flagMarker.position.set(
          group.position.x,
          group.position.y + baseY + floatSin * scale,
          group.position.z
        );
        this._flagMarker.scale.setScalar(scale);
        this._flagMarker.rotation.y = rotY;
      }
    }

    // セカンダリマーカー (半透明)
    if (this._flagMarkerSecondary && this._flagMarkerSecondary.visible && this._secondaryFlagForMarker) {
      const group = this._secondaryFlagForMarker.group;
      if (group) {
        const scale = group.scale.x;
        const baseY = 3.0 * scale;
        this._flagMarkerSecondary.position.set(
          group.position.x,
          group.position.y + baseY + floatSin * scale,
          group.position.z
        );
        this._flagMarkerSecondary.scale.setScalar(scale);
        this._flagMarkerSecondary.rotation.y = rotY;
      }
    }
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
