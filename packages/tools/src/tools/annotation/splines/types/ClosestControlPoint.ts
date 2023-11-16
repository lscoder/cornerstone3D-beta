import type { Point2 } from '../../math/types/Point2';
import type { ClosestPoint } from './ClosestPoint';

export type ClosestControlPoint = ClosestPoint & {
  index: number;
};
