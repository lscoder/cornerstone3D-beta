import { Spline } from './Spline';
import type { Point2 } from './types/Point2';
import type { AABB } from './types/AABB';
import type { SplineCurveSegment } from './types/SplineCurveSegment';
import type { SplineLineSegment } from './types/SplineLineSegment';

function getMirroredPoint(mirrorPoint: Point2, staticPoint: Point2): Point2 {
  const [x1, y1] = mirrorPoint;
  const [x2, y2] = staticPoint;

  const newX = 2 * x2 - x1;
  const newY = 2 * y2 - y1;

  return [newX, newY];
}

abstract class CubicSpline extends Spline {
  public getNumCurveSegments(): number {
    return this.closed
      ? this.controlPoints.length
      : this.controlPoints.length - 1;
  }

  /**
   * Get a point on a spline curve given `u` value
   *
   * @param u - Parameter space between 0 and N where N is the number of curve segments for opened
   *   splines or any negative/positive number for closed splines
   * @returns - Point (x, y) on the spline. It may return `undefined` when `u` is smaller than 0
   *   or greater than N for opened splines
   */
  public getPoint(u: number, transformMatrix: number[]): Point2 {
    const numCurveSegments = this.getNumCurveSegments();
    const uInt = Math.floor(u);
    let curveSegmentIndex = uInt % numCurveSegments;

    // `t` must be between 0 and 1
    const t = u - uInt;

    const curveSegmentIndexOutOfBounds =
      curveSegmentIndex < 0 || curveSegmentIndex >= numCurveSegments;

    if (curveSegmentIndexOutOfBounds) {
      if (this.closed) {
        // Wraps around when the index is negative or greater than or equal to `numSegments`
        curveSegmentIndex =
          (numCurveSegments + curveSegmentIndex) % numCurveSegments;
      } else {
        // Point is not on the spline curve
        return;
      }
    }

    const { p0, p1, p2, p3 } = this._getCurveSegmentPoints(curveSegmentIndex);

    // Formula to find any point on the spline curve given a `t` value
    //
    // P(t) = [1  t  t2  t3] | m00 m01 m02 m03 |  | P0 |
    //                       | m10 m11 m12 m13 |  | P1 |
    //                       | m20 m21 m22 m23 |  | P2 |
    //                       | m30 m31 m32 m33 |  | P3 |

    // prettier-ignore
    const [
      m00, m01, m02, m03,
      m10, m11, m12, m13,
      m20, m21, m22, m23,
      m30, m31, m32, m33,
    ] = transformMatrix;

    const tt = t * t;
    const ttt = tt * t;

    // Influential field values which tell us how much P0, P1, P2 and P3 influences
    // each point of the curve
    const q1 = m00 * 1 + m10 * t + m20 * tt + m30 * ttt;
    const q2 = m01 * 1 + m11 * t + m21 * tt + m31 * ttt;
    const q3 = m02 * 1 + m12 * t + m22 * tt + m32 * ttt;
    const q4 = m03 * 1 + m13 * t + m23 * tt + m33 * ttt;

    // Divide tx and ty by 2 because q1, q2, q3 and q4 can goes up to 2 but they need to be below 1
    const tx = p0[0] * q1 + p1[0] * q2 + p2[0] * q3 + p3[0] * q4;
    const ty = p0[1] * q1 + p1[1] * q2 + p2[1] * q3 + p3[1] * q4;

    return [tx, ty];
  }

  protected getSplineCurves(): SplineCurveSegment[] {
    const numCurveSegments = this.getNumCurveSegments();
    const curveSegments = new Array(numCurveSegments);

    if (numCurveSegments <= 0) {
      return [];
    }

    const transformMatrix = this.getTransformMatrix();

    for (let i = 0; i < numCurveSegments; i++) {
      const { p0, p1, p2, p3 } = this._getCurveSegmentPoints(i);
      const lineSegments = this._getLineSegments(i, transformMatrix);
      let curveSegmentLength = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      lineSegments.forEach((lineSegment) => {
        const { aabb: lineSegAABB } = lineSegment;

        minX = minX <= lineSegAABB.minX ? minX : lineSegAABB.minX;
        minY = minY <= lineSegAABB.minY ? minY : lineSegAABB.minY;
        maxX = maxX >= lineSegAABB.maxX ? maxX : lineSegAABB.maxX;
        maxY = maxY >= lineSegAABB.maxY ? maxY : lineSegAABB.maxY;
        curveSegmentLength += lineSegment.length;
      });

      curveSegments[i] = {
        controlPoints: { p0, p1, p2, p3 },
        aabb: { minX, minY, maxX, maxY },
        length: curveSegmentLength,
        lineSegments,
      };
    }

    return curveSegments;
  }

  private _getCurveSegmentPoints(curveSegmentIndex: number) {
    const numCurveSegments = this.getNumCurveSegments();
    const { controlPoints } = this;
    const p1Index = curveSegmentIndex;
    const p0Index = p1Index - 1;
    const p2Index = this.closed
      ? (p1Index + 1) % numCurveSegments
      : p1Index + 1;
    const p3Index = p2Index + 1;
    const p1 = controlPoints[p1Index];
    const p2 = controlPoints[p2Index];
    let p0;
    let p3;

    // P0 shall be negative when P1/P2 are the start/end points of the first curve segment
    if (p0Index >= 0) {
      p0 = controlPoints[p0Index];
    } else {
      p0 = this.closed
        ? controlPoints[controlPoints.length - 1]
        : getMirroredPoint(p2, p1);
    }

    // P3 shall be negative when P1/P2 are the start/end points of the last curve segment
    if (p3Index < controlPoints.length) {
      p3 = controlPoints[p3Index];
    } else {
      p3 = this.closed ? controlPoints[0] : getMirroredPoint(p1, p2);
    }

    return { p0, p1, p2, p3 };
  }

  private _getLineSegments(
    curveSegmentIndex: number,
    transformMatrix: number[]
  ): SplineLineSegment[] {
    const numCurveSegments = this.getNumCurveSegments();
    const numLineSegments = this.resolution + 1;
    const inc = 1 / numLineSegments;
    const minU = curveSegmentIndex;
    let maxU = minU + 1;

    // 'u' must be greater than or equal to 0 and smaller than N where N is the number of segments
    // otherwise it does not find the spline segment when it is not a closed curve because it is
    // 0-based indexed. In this case `u` needs to get very close to the end point but never touch it
    if (!this.closed && curveSegmentIndex === numCurveSegments - 1) {
      maxU -= 1e-8;
    }

    const lineSegments: SplineLineSegment[] = [];
    let startPoint: Point2;
    let endPoint: Point2;

    for (let i = 0, u = minU; i <= numLineSegments; i++, u += inc) {
      // `u` may be greater than maxU in the last FOR loop due to number precision issue
      u = u > maxU ? maxU : u;

      const point = this.getPoint(u, transformMatrix);

      if (i) {
        endPoint = point;

        const dx = endPoint[0] - startPoint[0];
        const dy = endPoint[1] - startPoint[1];
        const length = Math.sqrt(dx ** 2 + dy ** 2);
        const aabb: AABB = {
          minX: startPoint[0] <= endPoint[0] ? startPoint[0] : endPoint[0],
          maxX: startPoint[0] >= endPoint[0] ? startPoint[0] : endPoint[0],
          minY: startPoint[1] <= endPoint[1] ? startPoint[1] : endPoint[1],
          maxY: startPoint[1] >= endPoint[1] ? startPoint[1] : endPoint[1],
        };

        lineSegments.push({
          points: {
            start: startPoint,
            end: endPoint,
          },
          aabb,
          length,
        });

        // The start point of the next line segment is the end point of the current one
        startPoint = endPoint;
      } else {
        startPoint = point;
      }
    }

    return lineSegments;
  }

  private _getTransformMatrixDerivative(transformMatrix: number[]) {
    // prettier-ignore
    const [
      m00, m01, m02, m03,
      m10, m11, m12, m13,
      m20, m21, m22, m23,
      m30, m31, m32, m33,
    ] = transformMatrix;

    // TODO: calculate the derivative of a 4x4 matrix
  }
}

export { CubicSpline as default, CubicSpline };
