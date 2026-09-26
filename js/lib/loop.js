/* One requestAnimationFrame loop for the whole page: smooth scroll, UI and WebGL tick in order. */

const tasks = [];
let last = 0;
let running = false;

/** Registers fn(timeMs, dtSeconds). Lower `order` runs first. Returns an unsubscribe function. */
export function onFrame(fn, order = 0) {
  const task = { fn, order };
  tasks.push(task);
  tasks.sort((a, b) => a.order - b.order);
  return () => {
    const i = tasks.indexOf(task);
    if (i >= 0) tasks.splice(i, 1);
  };
}

function frame(time) {
  const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
  last = time;
  for (const task of tasks) task.fn(time, dt);
  requestAnimationFrame(frame);
}

export function startLoop() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}
