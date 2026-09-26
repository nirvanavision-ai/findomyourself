/*
 * A tiny photo studio, rendered once into an environment map: a dark room with a big
 * softbox overhead, a hot-pink strip on the left and a gold strip on the right. It's what
 * the chrome, the gold and the glass reflect.
 */
import {
  Scene, Mesh, BoxGeometry, PlaneGeometry, SphereGeometry, MeshBasicMaterial, Color, BackSide, DoubleSide, PMREMGenerator,
} from './three.js';

export function createEnvironment(renderer) {
  const scene = new Scene();
  const disposables = [];
  const add = (geometry, color, intensity, position, lookAt) => {
    const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    if (lookAt) mesh.lookAt(...lookAt);
    scene.add(mesh);
    disposables.push(geometry, material);
    return mesh;
  };

  const room = new Mesh(new BoxGeometry(24, 24, 24), new MeshBasicMaterial({ color: new Color('#0d0709'), side: BackSide }));
  scene.add(room);
  disposables.push(room.geometry, room.material);

  add(new PlaneGeometry(12, 5), '#fff6ef', 4.2, [0, 10, 3], [0, 0, 0]);       // overhead softbox
  add(new PlaneGeometry(1.4, 14), '#ff2e6e', 7, [-10, 0, 1], [0, 0, 0]);       // pink strip
  add(new PlaneGeometry(1.4, 14), '#ffbf66', 5, [10, 1, -1], [0, 0, 0]);       // gold strip
  add(new PlaneGeometry(10, 6), '#ffe9f0', 1.6, [2, 2, 11], [0, 0, 0]);        // soft front fill
  add(new PlaneGeometry(16, 8), '#5a1026', 0.9, [0, -2, -11], [0, 0, 0]);      // wine back wall
  add(new SphereGeometry(0.7, 16, 8), '#ffffff', 12, [5, 7, 7]);               // a hot spot for sparkle

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.035);
  pmrem.dispose();
  disposables.forEach((d) => d.dispose());
  return target.texture;
}
