const box = document.querySelector("#selectionBox");
const dimensionBadge = document.querySelector("#dimensionBadge");
const confirmButton = document.querySelector("#confirmButton");
const cancelButton = document.querySelector("#cancelButton");

const minimumWidth = 160;
const minimumHeight = 90;
let operation;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function initialRect() {
  const width = Math.round(Math.min(1280, Math.max(480, window.innerWidth * 0.68)));
  const height = Math.round(Math.min(720, Math.max(270, window.innerHeight * 0.68)));
  return {
    x: Math.round((window.innerWidth - width) / 2),
    y: Math.round((window.innerHeight - height) / 2),
    width,
    height,
  };
}

let rect = initialRect();

function normalizeRect(value) {
  const width = clamp(Math.round(value.width), minimumWidth, window.innerWidth);
  const height = clamp(Math.round(value.height), minimumHeight, window.innerHeight);
  return {
    x: clamp(Math.round(value.x), 0, window.innerWidth - width),
    y: clamp(Math.round(value.y), 0, window.innerHeight - height),
    width,
    height,
  };
}

function render() {
  rect = normalizeRect(rect);
  box.style.left = `${rect.x}px`;
  box.style.top = `${rect.y}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  dimensionBadge.textContent = `${rect.width} × ${rect.height}`;
}

function beginOperation(event) {
  if (event.button !== 0) return;
  const handle = event.target instanceof HTMLElement ? event.target.dataset.handle : undefined;
  operation = {
    kind: handle ? "resize" : "move",
    handle: handle ?? "",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...rect },
  };
  box.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveOperation(event) {
  if (!operation || event.pointerId !== operation.pointerId) return;
  const deltaX = event.clientX - operation.startX;
  const deltaY = event.clientY - operation.startY;
  const start = operation.startRect;

  if (operation.kind === "move") {
    rect = {
      ...start,
      x: clamp(start.x + deltaX, 0, window.innerWidth - start.width),
      y: clamp(start.y + deltaY, 0, window.innerHeight - start.height),
    };
    render();
    return;
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const handle = operation.handle;

  if (handle.includes("w")) left = clamp(start.x + deltaX, 0, right - minimumWidth);
  if (handle.includes("e")) right = clamp(start.x + start.width + deltaX, left + minimumWidth, window.innerWidth);
  if (handle.includes("n")) top = clamp(start.y + deltaY, 0, bottom - minimumHeight);
  if (handle.includes("s")) bottom = clamp(start.y + start.height + deltaY, top + minimumHeight, window.innerHeight);

  rect = { x: left, y: top, width: right - left, height: bottom - top };
  render();
}

function endOperation(event) {
  if (!operation || event.pointerId !== operation.pointerId) return;
  if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId);
  operation = undefined;
}

function confirm() {
  window.autoScreen.confirmRegion(normalizeRect(rect));
}

box.addEventListener("pointerdown", beginOperation);
box.addEventListener("pointermove", moveOperation);
box.addEventListener("pointerup", endOperation);
box.addEventListener("pointercancel", endOperation);
confirmButton.addEventListener("click", confirm);
cancelButton.addEventListener("click", () => window.autoScreen.cancelRegion());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.autoScreen.cancelRegion();
  if (event.key === "Enter") confirm();
});
window.addEventListener("resize", render);
render();
