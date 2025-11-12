# tSNE-vis-3d

A browser-based, artistic 3D explorer for t-SNE point clouds. It renders JSONL point
cloud data using Three.js, animates clusters with a subtle pulse, and surfaces rich
metadata on hover and click.

## Getting started

1. Serve the project with any static file server. For example:
   ```bash
   npx serve .
   ```
   or use your preferred hosting method.
2. Open the reported URL (typically http://localhost:3000) in a modern browser.

The visualization auto-fits the viewport and provides orbit controls for rotation,
panning, and zooming. Hover a point to preview its snippet, or click to pin a
story card with the full text and optional hyperlink. Use the cluster palette to
spotlight a single cluster—the camera recenters around its centroid while other
groups gracefully fade—and tap **Back to all clusters** to return to the full
constellation.

## Data format

Place your JSONL file at `assets/data/sample.jsonl` or adjust the fetch path in
`main.js`. Each line should be a JSON object with the following keys:

| Key                     | Type    | Description                                           |
| ----------------------- | ------- | ----------------------------------------------------- |
| `t-SNE Component 1`     | number  | X coordinate from t-SNE                               |
| `t-SNE Component 2`     | number  | Y coordinate from t-SNE                               |
| `t-SNE Component 3`     | number  | Z coordinate from t-SNE                               |
| `Cluster`               | number  | Cluster identifier used for color coding              |
| `Descriptive_Cluster_Label` | string | (Optional) Human-friendly cluster label             |
| `Original String`       | string  | Full text shown in the info panel                     |
| `Original String Chopped` | string | Short preview text for tooltips                     |
| `URL`                   | string  | (Optional) Hyperlink opened from the info panel       |

Additional properties are ignored but preserved in the pinned info panel for
future extension.

## Customization ideas

- Replace the background shader or lighting to match your brand.
- Tune point sizing in `createPointCloud` if your dataset is very large or small.
- Extend `showInfoPanel` to surface further metadata (e.g., author, timestamp).
- Swap the JSONL loader for streaming or WebSocket updates to animate evolving clouds.
