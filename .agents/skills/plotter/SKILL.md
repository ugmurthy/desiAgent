---
name: plotter
description: "Generates line or bar chart as an SVG file given a y-array, with optional x-array and chart type selection."
type: executable
parameters:
  type: object
  properties:
    y:
      type: array
      items: { type: number }
      description: Array of y-values to plot
    x:
      type: array
      items: { type: number }
      description: "Optional x-values. If omitted, y values are uniformly spaced starting at 0."
    type:
      type: string
      enum: [line, bar]
      description: "Chart type: 'line' or 'bar'. Defaults to 'line'."
    title:
      type: string
      description: Optional chart title
    output:
      type: string
      description: "Output file path for the SVG. Defaults to 'artifacts/chart.svg'."
  required: [y]
---

# Plotter Skill

Generates a clean SVG chart (line or bar) from numerical data. No external dependencies — pure TypeScript SVG generation.

- Outputs an SVG file to the specified path (default: `artifacts/chart.svg`)
- Supports optional title, custom x-values, and chart type selection
