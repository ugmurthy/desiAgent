// skills/derivative/handler.ts
// Computes first or second numerical derivative using finite differences.

export default async function derivative(args: {
  y: number[];
  dx: number;
  order?: number;
}): Promise<string> {
  const { y, dx, order = 1 } = args;

  if (!Array.isArray(y) || y.length < 2) {
    return JSON.stringify({ error: "y must be an array with at least 2 elements" });
  }
  if (dx <= 0) {
    return JSON.stringify({ error: "dx must be a positive number" });
  }
  if (order !== 1 && order !== 2) {
    return JSON.stringify({ error: "order must be 1 or 2" });
  }

  const first = firstDerivative(y, dx);
  if (order === 1) {
    return JSON.stringify({ order: 1, dx, derivative: first });
  }

  // Second derivative: derivative of the first derivative
  if (y.length < 3) {
    return JSON.stringify({ error: "y must have at least 3 elements for second derivative" });
  }
  const second = secondDerivative(y, dx);
  return JSON.stringify({ order: 2, dx, derivative: second });
}

function firstDerivative(y: number[], dx: number): number[] {
  const n = y.length;
  const dy = new Array<number>(n);

  // Forward difference at start
  dy[0] = (y[1] - y[0]) / dx;

  // Central differences for interior points
  for (let i = 1; i < n - 1; i++) {
    dy[i] = (y[i + 1] - y[i - 1]) / (2 * dx);
  }

  // Backward difference at end
  dy[n - 1] = (y[n - 1] - y[n - 2]) / dx;

  return dy;
}

function secondDerivative(y: number[], dx: number): number[] {
  const n = y.length;
  const d2y = new Array<number>(n);
  const dx2 = dx * dx;

  // Forward second difference at start
  d2y[0] = (y[2] - 2 * y[1] + y[0]) / dx2;

  // Central second differences for interior
  for (let i = 1; i < n - 1; i++) {
    d2y[i] = (y[i + 1] - 2 * y[i] + y[i - 1]) / dx2;
  }

  // Backward second difference at end
  d2y[n - 1] = (y[n - 1] - 2 * y[n - 2] + y[n - 3]) / dx2;

  return d2y;
}
