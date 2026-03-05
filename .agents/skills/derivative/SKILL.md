---
name: derivative
description: "Computes first or second numerical derivative of an array of floats using finite differences, given a step size dx."
type: executable
parameters:
  type: object
  properties:
    y:
      type: array
      items: { type: number }
      description: Array of y-values (floats)
    dx:
      type: number
      description: Step size between consecutive x-values
    order:
      type: number
      description: "Derivative order: 1 (first) or 2 (second). Defaults to 1."
  required: [y, dx]
---

# Derivative Skill

Computes numerical derivatives of sampled data using central finite differences (forward/backward at boundaries).

- **First derivative**: approximates dy/dx
- **Second derivative**: approximates d²y/dx²

Expects `y` (array of floats) and `dx` (step size). Returns the derivative array as a JSON string.
