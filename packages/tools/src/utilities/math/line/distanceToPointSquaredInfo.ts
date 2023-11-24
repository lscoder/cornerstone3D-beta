import type { Types } from '@cornerstonejs/core';
import * as math from '../';

/**
 * Calculate the closest point and the squared distance between a reference point and a line segment.
 *
 * It projects the reference point onto the line segment but it shall be bounded by the
 * start/end points since this is a line segment and not a line which could be extended.
 *
 * @param lineStart - Start point of the line segment
 * @param lineEnd - End point of the line segment
 * @param point - Reference point
 * @returns Closest point and the squared distance between a `point` and a line
 *   segment defined by `lineStart` and `lineEnd` points
 */
export default function distanceToPointSquaredInfo(
  lineStart: Types.Point2,
  lineEnd: Types.Point2,
  point: Types.Point2
): {
  point: Types.Point2;
  distanceSquared: number;
} {
  let closestPoint: Types.Point2;
  let distanceSquared;

  // Check if lineStart is the same as lineEnd which means
  // the line has length equal to 0.
  if (lineStart[0] === lineEnd[0] && lineStart[1] === lineEnd[1]) {
    distanceSquared = 0;
    closestPoint = lineStart;
  } else {
    distanceSquared = math.point.distanceToPointSquared(lineStart, lineEnd);
  }

  if (!closestPoint) {
    const t =
      ((point[0] - lineStart[0]) * (lineEnd[0] - lineStart[0]) +
        (point[1] - lineStart[1]) * (lineEnd[1] - lineStart[1])) /
      distanceSquared;

    if (t < 0) {
      closestPoint = lineStart;
    } else if (t > 1) {
      closestPoint = lineEnd;
    } else {
      closestPoint = [
        lineStart[0] + t * (lineEnd[0] - lineStart[0]),
        lineStart[1] + t * (lineEnd[1] - lineStart[1]),
      ];
    }
  }

  return {
    point: [...closestPoint],
    distanceSquared: math.point.distanceToPointSquared(point, closestPoint),
  };
}
