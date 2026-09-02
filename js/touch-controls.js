/**
 * touch-controls.js
 * タッチ操作（スワイプ移動・ピンチ拡縮・オブジェクト選択）
 */

export class TouchControls {
  /**
   * @param {HTMLCanvasElement} canvas - Three.js の描画先 Canvas
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Scene} scene
   */
  constructor(canvas, camera, scene) {
    this._canvas = canvas;
    this._camera = camera;
    this._scene = scene;
    this._raycaster = new THREE.Raycaster();
    this._enabled = true;

    /** @type {THREE.Group|null} 現在選択中ののぼり旗グループ */
    this._selected = null;
    /** @type {THREE.Object3D[]} Raycaster 対象のメッシュ一覧 */
    this._targets = [];

    // タッチ状態
    this._isDragging = false;
    this._isPinching = false;
    this._lastTouch = { x: 0, y: 0 };
    this._lastPinchDist = 0;

    // イベントリスナー登録 (タッチ & マウス)
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);

    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);

    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: false });

    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /** 操作可能な対象オブジェクト（メッシュ）を登録 */
  addTarget(mesh) {
    this._targets.push(mesh);
  }

  /** 対象オブジェクトを削除 */
  removeTarget(mesh) {
    const idx = this._targets.indexOf(mesh);
    if (idx !== -1) this._targets.splice(idx, 1);
  }

  /** 対象リストをクリア */
  clearTargets() {
    this._targets = [];
  }

  /** @returns {THREE.Group|null} 選択中のオブジェクト */
  get selected() {
    return this._selected;
  }

  set enabled(val) {
    this._enabled = val;
  }

  /** @returns {boolean} 操作中か否か（カメラ制御の一時停止判定用） */
  get isInteracting() {
    return this._isDragging || this._isPinching;
  }

  /** 選択をリセット */
  deselect() {
    this._selected = null;
    this._canvas.dispatchEvent(new CustomEvent('flag-deselected'));
  }

  // ────────── Private ──────────

  _getNDC(touch) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: ((touch.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((touch.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  _handleTouchStart(e) {
    if (!this._enabled) return;

    if (e.touches.length === 1) {
      e.preventDefault();
      const ndc = this._getNDC(e.touches[0]);
      this._raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this._camera);
      const intersects = this._raycaster.intersectObjects(this._targets, true);

      if (intersects.length > 0) {
        // 当たったメッシュの親 Group（のぼり旗全体）を選択
        let obj = intersects[0].object;
        while (obj.parent && !obj.userData.isBannerFlag) {
          obj = obj.parent;
        }
        if (obj.userData.isBannerFlag) {
          this._selected = obj;
          this._isDragging = true;
          this._lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          this._canvas.dispatchEvent(new CustomEvent('flag-selected', {
            detail: { group: obj, index: obj.userData.flagIndex },
          }));
        }
      } else {
        // 空タップ → 選択解除
        if (this._selected) {
          this.deselect();
        }
      }
    } else if (e.touches.length === 2 && this._selected) {
      e.preventDefault();
      this._isPinching = true;
      this._isDragging = false;
      this._lastPinchDist = this._getPinchDistance(e.touches);
    }
  }

  _handleTouchMove(e) {
    if (!this._enabled) return;

    // 1本指ドラッグ: XZ平面上の移動
    if (this._isDragging && this._selected && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - this._lastTouch.x;
      const dy = e.touches[0].clientY - this._lastTouch.y;

      // スクリーンの移動量を3D空間の移動量に変換
      // カメラからの距離に応じてスケーリング
      const distance = this._camera.position.distanceTo(this._selected.position);
      const factor = distance * 0.003;

      // カメラの向き基準で移動
      const cameraDir = new THREE.Vector3();
      this._camera.getWorldDirection(cameraDir);
      const right = new THREE.Vector3().crossVectors(cameraDir, this._camera.up).normalize();
      const forward = new THREE.Vector3().crossVectors(this._camera.up, right).normalize();

      this._selected.position.addScaledVector(right, dx * factor);
      this._selected.position.addScaledVector(forward, -dy * factor);

      this._lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      this._canvas.dispatchEvent(new CustomEvent('flag-transform', {
        detail: {
          group: this._selected,
          index: this._selected.userData.flagIndex,
          position: this._selected.position,
          scale: this._selected.scale.x,
        },
      }));
    }

    // 2本指ピンチ: 拡大縮小
    if (this._isPinching && this._selected && e.touches.length === 2) {
      e.preventDefault();
      const dist = this._getPinchDistance(e.touches);
      const scale = dist / this._lastPinchDist;

      const newScale = THREE.MathUtils.clamp(
        this._selected.scale.x * scale,
        0.3,
        3.0
      );
      this._selected.scale.setScalar(newScale);
      this._lastPinchDist = dist;

      this._canvas.dispatchEvent(new CustomEvent('flag-transform', {
        detail: {
          group: this._selected,
          index: this._selected.userData.flagIndex,
          position: this._selected.position,
          scale: this._selected.scale.x,
        },
      }));
    }
  }

  _handleTouchEnd(e) {
    if (e.touches.length === 0) {
      this._isDragging = false;
      this._isPinching = false;
      this._canvas.dispatchEvent(new CustomEvent('flag-transform-end'));
    } else if (e.touches.length === 1) {
      this._isPinching = false;
      if (this._selected) {
        this._isDragging = true;
        this._lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }
  }

  _getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ────────── マウスイベントハンドラ (PC対応) ──────────

  _handleMouseDown(e) {
    if (!this._enabled || e.button !== 0) return; // 左クリックのみ
    const ndc = this._getNDC(e);
    this._raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this._camera);
    const intersects = this._raycaster.intersectObjects(this._targets, true);

    if (intersects.length > 0) {
      let obj = intersects[0].object;
      while (obj.parent && !obj.userData.isBannerFlag) {
        obj = obj.parent;
      }
      if (obj.userData.isBannerFlag) {
        this._selected = obj;
        this._isDragging = true;
        this._lastTouch = { x: e.clientX, y: e.clientY };
        this._canvas.dispatchEvent(new CustomEvent('flag-selected', {
          detail: { group: obj, index: obj.userData.flagIndex },
        }));
      }
    } else {
      // 空クリック → 選択解除
      if (this._selected) {
        this.deselect();
      }
    }
  }

  _handleMouseMove(e) {
    if (!this._enabled || !this._isDragging || !this._selected) return;

    const dx = e.clientX - this._lastTouch.x;
    const dy = e.clientY - this._lastTouch.y;

    const distance = this._camera.position.distanceTo(this._selected.position);
    const factor = distance * 0.003;

    const cameraDir = new THREE.Vector3();
    this._camera.getWorldDirection(cameraDir);
    const right = new THREE.Vector3().crossVectors(cameraDir, this._camera.up).normalize();
    const forward = new THREE.Vector3().crossVectors(this._camera.up, right).normalize();

    this._selected.position.addScaledVector(right, dx * factor);
    this._selected.position.addScaledVector(forward, -dy * factor);

    this._lastTouch = { x: e.clientX, y: e.clientY };

    this._canvas.dispatchEvent(new CustomEvent('flag-transform', {
      detail: {
        group: this._selected,
        index: this._selected.userData.flagIndex,
        position: this._selected.position,
        scale: this._selected.scale.x,
      },
    }));
  }

  _handleMouseUp(e) {
    if (this._isDragging) {
      this._isDragging = false;
      this._canvas.dispatchEvent(new CustomEvent('flag-transform-end'));
    }
  }

  _handleWheel(e) {
    if (!this._enabled || !this._selected) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 0.95;
    const newScale = THREE.MathUtils.clamp(
      this._selected.scale.x * factor,
      0.3,
      3.0
    );
    this._selected.scale.setScalar(newScale);

    this._canvas.dispatchEvent(new CustomEvent('flag-transform', {
      detail: {
        group: this._selected,
        index: this._selected.userData.flagIndex,
        position: this._selected.position,
        scale: this._selected.scale.x,
      },
    }));
    this._canvas.dispatchEvent(new CustomEvent('flag-transform-end'));
  }

  /** リスナーを解除 */
  dispose() {
    this._canvas.removeEventListener('touchstart', this._onTouchStart);
    this._canvas.removeEventListener('touchmove', this._onTouchMove);
    this._canvas.removeEventListener('touchend', this._onTouchEnd);
    this._canvas.removeEventListener('touchcancel', this._onTouchEnd);

    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    this._canvas.removeEventListener('wheel', this._onWheel);
  }
}
