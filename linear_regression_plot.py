"""Scatter plot a dataset and overlay a fitted linear regression line.

Usage as a library:
    from linear_regression_plot import fit_linear_regression, plot_scatter_with_regression

    slope, intercept, r_squared = fit_linear_regression(x, y)
    plot_scatter_with_regression(x, y, output_path="plot.png")

Usage as a CLI:
    python linear_regression_plot.py data.csv --x-col x --y-col y --output plot.png
"""

import argparse
import csv

import numpy as np
import matplotlib.pyplot as plt


def fit_linear_regression(x, y):
    """Fit y = slope * x + intercept via least squares. Returns (slope, intercept, r_squared)."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    slope, intercept = np.polyfit(x, y, 1)

    y_pred = slope * x + intercept
    ss_res = np.sum((y - y_pred) ** 2)
    ss_tot = np.sum((y - np.mean(y)) ** 2)
    r_squared = 1 - ss_res / ss_tot if ss_tot != 0 else 1.0

    return slope, intercept, r_squared


def plot_scatter_with_regression(x, y, title="Scatter plot with linear regression",
                                  x_label="x", y_label="y", output_path=None):
    """Plot a scatter of (x, y) with a fitted regression line. Shows the plot, or saves it if output_path is given."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)

    slope, intercept, r_squared = fit_linear_regression(x, y)

    fig, ax = plt.subplots()
    ax.scatter(x, y, label="Data")

    line_x = np.linspace(x.min(), x.max(), 100)
    line_y = slope * line_x + intercept
    ax.plot(line_x, line_y, color="red",
            label=f"y = {slope:.3f}x + {intercept:.3f} (R² = {r_squared:.3f})")

    ax.set_title(title)
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)
    ax.legend()

    if output_path:
        fig.savefig(output_path)
        print(f"Saved plot to {output_path}")
    else:
        plt.show()

    return slope, intercept, r_squared


def _read_csv_columns(csv_path, x_col, y_col):
    x, y = [], []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            x.append(float(row[x_col]))
            y.append(float(row[y_col]))
    return x, y


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="Path to a CSV file containing the data")
    parser.add_argument("--x-col", default="x", help="Name of the column to use as x values")
    parser.add_argument("--y-col", default="y", help="Name of the column to use as y values")
    parser.add_argument("--output", default=None, help="Path to save the plot image instead of displaying it")
    args = parser.parse_args()

    x, y = _read_csv_columns(args.csv_path, args.x_col, args.y_col)
    slope, intercept, r_squared = plot_scatter_with_regression(
        x, y, x_label=args.x_col, y_label=args.y_col, output_path=args.output
    )
    print(f"slope={slope:.6f}, intercept={intercept:.6f}, r_squared={r_squared:.6f}")


if __name__ == "__main__":
    main()
