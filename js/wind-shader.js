/**
 * wind-shader.js
 * 風なびきアニメーション用のGLSLシェーダーと ShaderMaterial 生成ヘルパー
 */

/** 頂点シェーダー: 風による旗の変形 */
const flagVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindAngle;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;

    vec3 pos = position;

    // ── 固定度の計算 ──
    // uv.x=0 (左辺=ポール接続) → 固定
    // uv.y=1 (上辺=横棒接続)   → 固定
    // 右下に向かうほど自由に動く
    float fixX = smoothstep(0.0, 0.12, uv.x);
    float fixY = 1.0 - smoothstep(0.88, 1.0, uv.y);
    float fixFactor = fixX * fixY;

    // ── 風の方向ベクトル ──
    float windRad = uWindAngle;
    float windDirX = cos(windRad);
    float windDirZ = sin(windRad);

    // ── 複数周波数の波形で自然な揺れを表現 ──
    float t = uTime;
    float wave1 = sin(t * 2.5 + pos.y * 4.0 + pos.x * 2.0) * 0.45;
    float wave2 = sin(t * 3.8 + pos.y * 6.0 + pos.x * 3.0) * 0.25;
    float wave3 = sin(t * 1.3 + pos.y * 1.5) * 0.30;
    float wave  = wave1 + wave2 + wave3;

    float disp = wave * uWindStrength * fixFactor;

    // Z方向を主に、X方向にも少し変位
    pos.z += disp * windDirZ * 0.8;
    pos.x += disp * windDirX * 0.25;
    // 風で引っ張られた分の微小な垂れ下がり
    pos.y -= abs(disp) * 0.04;

    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

/** フラグメントシェーダー: テクスチャ描画 + 簡易ライティング + 不透明度 */
const flagFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec3 uLightDir;
  uniform float uLightIntensity;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);

    // 簡易 Lambert ライティング
    vec3 lightDir = normalize(uLightDir);
    float NdotL = dot(vNormal, lightDir);
    float diffuse = max(NdotL, 0.0) * uLightIntensity;

    // 裏面も少し照らす (両面ライティング)
    float backDiffuse = max(-NdotL, 0.0) * uLightIntensity * 0.4;
    float totalLight = 0.35 + (diffuse + backDiffuse) * 0.65;

    gl_FragColor = vec4(texColor.rgb * totalLight, texColor.a * uOpacity);
  }
`;

/**
 * 風なびきシェーダーマテリアルを生成
 * @param {THREE.Texture} texture - 旗に貼るテクスチャ
 * @param {number} [opacity=0.95] - 不透明度
 * @returns {THREE.ShaderMaterial}
 */
export function createWindMaterial(texture, opacity = 0.90) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTexture:       { value: texture },
      uTime:          { value: 0.0 },
      uWindStrength:  { value: 0.3 },
      uWindAngle:     { value: Math.PI * 0.5 },
      uLightDir:      { value: new THREE.Vector3(1, 1, 1).normalize() },
      uLightIntensity: { value: 1.0 },
      uOpacity:       { value: opacity },
    },
    vertexShader: flagVertexShader,
    fragmentShader: flagFragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false, // 透過オブジェクトの描画順序トラブル防止
  });
}

export { flagVertexShader, flagFragmentShader };
