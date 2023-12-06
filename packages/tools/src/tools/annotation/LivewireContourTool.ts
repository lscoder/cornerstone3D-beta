import { AnnotationTool } from '../base';

import {
  getEnabledElement,
  eventTarget,
  triggerEvent,
  utilities as csUtils,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import {
  addAnnotation,
  getAnnotations,
  removeAnnotation,
} from '../../stateManagement/annotation/annotationState';
import { isAnnotationLocked } from '../../stateManagement/annotation/annotationLocking';
import { isAnnotationVisible } from '../../stateManagement/annotation/annotationVisibility';
import {
  drawHandles as drawHandlesSvg,
  drawPolyline as drawPolylineSvg,
} from '../../drawingSvg';
import { state } from '../../store';
import { Events } from '../../enums';
import { resetElementCursor } from '../../cursors/elementCursor';
import {
  EventTypes,
  ToolHandle,
  PublicToolProps,
  ToolProps,
  SVGDrawingHelper,
} from '../../types';
import {
  math,
  viewportFilters,
  triggerAnnotationRenderForViewportIds,
} from '../../utilities';
import { LivewireContourAnnotation } from '../../types/ToolSpecificAnnotationTypes';
import {
  AnnotationCompletedEventDetail,
  AnnotationModifiedEventDetail,
} from '../../types/EventTypes';
import { StyleSpecifier } from '../../types/AnnotationStyle';

import { LivewireScissors } from '../../utilities/livewire/LivewireScissors';
import { LivewirePath } from '../../utilities/livewire/LiveWirePath';

const { getViewportIdsWithToolToRender } = viewportFilters;
const CLICK_CLOSE_CURVE_SQR_DIST = 10 ** 2;

class LivewireContourTool extends AnnotationTool {
  public static toolName: string;
  private scissors: LivewireScissors;

  touchDragCallback: any;
  mouseDragCallback: any;
  editData: {
    annotation: LivewireContourAnnotation;
    viewportIdsToRender: Array<string>;
    handleIndex?: number;
    newAnnotation?: boolean;
    hasMoved?: boolean;
    lastCanvasPoint?: Types.Point2;
    confirmedPath?: LivewirePath;
    currentPath?: LivewirePath;
    closed?: boolean;
  } | null;
  isDrawing: boolean;
  isHandleOutsideImage = false;

  constructor(
    toolProps: PublicToolProps = {},
    defaultToolProps: ToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        preventHandleOutsideImage: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Based on the current position of the mouse and the current imageId to create
   * a CircleROI Annotation and stores it in the annotationManager
   *
   * @param evt -  EventTypes.NormalizedMouseEventType
   * @returns The annotation object.
   *
   */
  addNewAnnotation = (
    evt: EventTypes.InteractionEventType
  ): LivewireContourAnnotation => {
    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const { world: worldPos, canvas: canvasPos } = currentPoints;

    const enabledElement = getEnabledElement(element);
    const { viewport, renderingEngine } = enabledElement;

    this.isDrawing = true;

    const camera = viewport.getCamera();
    const { viewPlaneNormal, viewUp } = camera;

    const referencedImageId = this.getReferencedImageId(
      viewport,
      worldPos,
      viewPlaneNormal,
      viewUp
    );

    const FrameOfReferenceUID = viewport.getFrameOfReferenceUID();
    const defaultActor = (<Types.IViewport>viewport).getDefaultActor();

    if (!defaultActor || !csUtils.isImageActor(defaultActor)) {
      throw new Error('Default actor must be an image actor');
    }

    // const { uid: volumeId } = defaultActor;
    // const volume = cache.getVolume(volumeId);
    const { actor } = defaultActor;
    const vtkImageData = actor.getMapper().getInputData();
    const dimensions = vtkImageData.getDimensions();
    const [width, height] = dimensions;
    const scalarData = vtkImageData.getPointData().getScalars().getData();
    const { voiRange } = viewport.getProperties();

    // TODO: See what to do when working with mpr-able because this should be the
    // index from the image space place related to the image sent to scissor.setData()
    const imagePos = csUtils.transformWorldToIndex(vtkImageData, worldPos);
    const slicePos: Types.Point2 = [imagePos[0], imagePos[1]];

    this.scissors = LivewireScissors.createInstanceFromRawPixelData(
      scalarData,
      width,
      height,
      voiRange
    );

    this.scissors.startSearch(slicePos);

    const confirmedPath = new LivewirePath();
    const currentPath = new LivewirePath();
    const p0: Types.Point2 = [imagePos[0], imagePos[1]];

    confirmedPath.addPoint(p0);
    confirmedPath.addControlPoint(p0);

    const annotation: LivewireContourAnnotation = {
      highlighted: true,
      invalidated: true,
      metadata: {
        toolName: this.getToolName(),
        viewPlaneNormal: <Types.Point3>[...viewPlaneNormal],
        viewUp: <Types.Point3>[...viewUp],
        FrameOfReferenceUID,
        referencedImageId,
      },
      data: {
        polyline: [],
        handles: {
          points: [],
          activeHandleIndex: null,
        },
      },
    };

    addAnnotation(annotation, element);

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    this.editData = {
      annotation,
      viewportIdsToRender,
      newAnnotation: true,
      hasMoved: false,
      lastCanvasPoint: canvasPos,
      confirmedPath: confirmedPath,
      currentPath: currentPath,
      closed: false,
    };

    this._activateDraw(element);
    evt.preventDefault();
    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    return annotation;
  };

  /**
   * It returns if the canvas point is near the provided annotation in the provided
   * element or not. A proximity is passed to the function to determine the
   * proximity of the point to the annotation in number of pixels.
   *
   * @param element - HTML Element
   * @param annotation - Annotation
   * @param canvasCoords - Canvas coordinates
   * @param proximity - Proximity to tool to consider
   * @returns Boolean, whether the canvas point is near tool
   */
  isPointNearTool = (
    element: HTMLDivElement,
    annotation: LivewireContourAnnotation,
    canvasCoords: Types.Point2,
    proximity: number
  ): boolean => {
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;
    const proximitySquared = proximity * proximity;
    const canvasPoints = annotation.data.polyline.map((p) =>
      viewport.worldToCanvas(p)
    );

    let startPoint = canvasPoints[canvasPoints.length - 1];

    for (let i = 0; i < canvasPoints.length; i++) {
      const endPoint = canvasPoints[i];
      const distanceToPointSquared = math.lineSegment.distanceToPointSquared(
        startPoint,
        endPoint,
        canvasCoords
      );

      if (distanceToPointSquared <= proximitySquared) {
        return true;
      }

      startPoint = endPoint;
    }

    return false;
  };

  toolSelectedCallback = (
    evt: EventTypes.InteractionEventType,
    annotation: LivewireContourAnnotation
  ): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    annotation.highlighted = true;

    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    this.editData = {
      annotation,
      viewportIdsToRender,
    };

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    this._activateModify(element);
    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);
    evt.preventDefault();
  };

  handleSelectedCallback = (
    evt: EventTypes.InteractionEventType,
    annotation: LivewireContourAnnotation,
    handle: ToolHandle
  ): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;
    const { data } = annotation;

    annotation.highlighted = true;

    const { points } = data.handles;
    const handleIndex = points.findIndex((p) => p === handle);

    // Find viewports to render on drag.
    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    this.editData = {
      annotation,
      viewportIdsToRender,
      handleIndex,
    };
    this._activateModify(element);

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    evt.preventDefault();
  };

  _endCallback = (evt: EventTypes.InteractionEventType): void => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    const { annotation, viewportIdsToRender, newAnnotation } = this.editData;
    const { data } = annotation;

    data.handles.activeHandleIndex = null;

    this._deactivateModify(element);
    this._deactivateDraw(element);

    resetElementCursor(element);

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    if (
      this.isHandleOutsideImage &&
      this.configuration.preventHandleOutsideImage
    ) {
      removeAnnotation(annotation.annotationUID);
    }

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    if (newAnnotation) {
      const eventType = Events.ANNOTATION_COMPLETED;
      const eventDetail: AnnotationCompletedEventDetail = {
        annotation,
      };

      triggerEvent(eventTarget, eventType, eventDetail);
    }

    this.editData = null;
    this.scissors = null;
    this.isDrawing = false;
  };

  private _mouseDownCallback = (evt: EventTypes.InteractionEventType): void => {
    const { annotation, viewportIdsToRender } = this.editData;

    if (this.editData.closed) {
      return;
    }

    const eventDetail = evt.detail;
    const { element } = eventDetail;
    const { currentPoints } = eventDetail;
    const { canvas: canvasPos, world: worldPos } = currentPoints;
    const enabledElement = getEnabledElement(element);
    const { viewport, renderingEngine } = enabledElement;
    const defaultActor = (<Types.IViewport>viewport).getDefaultActor();
    const { actor } = defaultActor;
    const vtkImageData = actor.getMapper().getInputData();
    const controlPoints = this.editData.currentPath.getControlPoints();
    let closePath = false;

    // Check if user clicked on the first point to close the curve
    if (controlPoints.length >= 2) {
      const closestHandlePoint = {
        index: -1,
        distSquared: Infinity,
      };

      for (let i = 0, len = controlPoints.length; i < len; i++) {
        const controlPoint = controlPoints[i];
        const sliceIndex = 1; // TODO: change it for volume viewports
        const imagePoint = [controlPoint[0], controlPoint[1], sliceIndex];
        const worldControlPoint = csUtils.transformIndexToWorld(
          vtkImageData,
          imagePoint
        );
        const canvasControlPoint = viewport.worldToCanvas(worldControlPoint);

        const distSquared = math.point.distanceToPointSquared(
          canvasPos,
          canvasControlPoint
        );

        if (
          distSquared <= CLICK_CLOSE_CURVE_SQR_DIST &&
          distSquared < closestHandlePoint.distSquared
        ) {
          closestHandlePoint.distSquared = distSquared;
          closestHandlePoint.index = i;
        }
      }

      if (closestHandlePoint.index === 0) {
        closePath = true;
      }
    }

    this.editData.closed = this.editData.closed || closePath;

    const imagePos = csUtils.transformWorldToIndex(vtkImageData, worldPos);
    const slicePos: Types.Point2 = [imagePos[0], imagePos[1]];

    this.editData.confirmedPath = this.editData.currentPath;

    // Add the current cursor position as a new control point after clicking
    this.editData.confirmedPath.addControlPoint(
      this.editData.currentPath.getLastPoint()
    );

    // Start a new search starting at the last control point
    this.scissors.startSearch(slicePos);

    annotation.invalidated = true;
    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    if (this.editData.closed) {
      // Update the annotation because `editData` will be set to null
      this._updateAnnotation(element, this.editData.confirmedPath);
      this._endCallback(evt);
    }

    evt.preventDefault();
  };

  private _mouseMoveCallback = (evt: EventTypes.InteractionEventType): void => {
    const { element, currentPoints } = evt.detail;
    const { world: worldPos, canvas: canvasPos } = currentPoints;
    const { viewport, renderingEngine } = getEnabledElement(element);
    // const { annotation } = this.editData;
    // const { data } = annotation;
    const viewportIdsToRender = getViewportIdsWithToolToRender(
      element,
      this.getToolName()
    );

    this.editData.lastCanvasPoint = canvasPos;

    const defaultActor = (<Types.IStackViewport>viewport).getDefaultActor();
    const { actor } = defaultActor;
    const vtkImageData = actor.getMapper().getInputData();
    const dimensions = vtkImageData.getDimensions();
    const [imgWidth, imgHeight] = dimensions;

    // TODO: See what to do when working with volumes because imagePos should be
    // the index in volume space
    const imagePos = csUtils.transformWorldToIndex(vtkImageData, worldPos);
    const slicePoint: Types.Point2 = [imagePos[0], imagePos[1]];

    // Check if the point is inside the bounding box
    if (
      slicePoint[0] < 0 ||
      slicePoint[1] < 0 ||
      slicePoint[0] >= imgWidth ||
      slicePoint[1] >= imgHeight
    ) {
      return;
    }

    const pathPoints = this.scissors.findPathToPoint(slicePoint);
    const currentPath = new LivewirePath();

    for (let i = 0, len = pathPoints.length; i < len; i++) {
      currentPath.addPoint(pathPoints[i]);
    }

    // Merge the "confirmed" path that goes from the first control point to the
    // last one with the current path that goes from the last control point to
    // the cursor point
    currentPath.prependPath(this.editData.confirmedPath);

    // Store the new path
    this.editData.currentPath = currentPath;

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);
    evt.preventDefault();
  };

  private _dragCallback = (evt: EventTypes.InteractionEventType): void => {
    this.isDrawing = true;
    const eventDetail = evt.detail;
    const { element } = eventDetail;

    const { annotation, viewportIdsToRender, handleIndex } = this.editData;
    const { data } = annotation;

    if (handleIndex === undefined) {
      // Drag mode - moving handle
      const { deltaPoints } = eventDetail as EventTypes.MouseDragEventDetail;
      const worldPosDelta = deltaPoints.world;

      const points = data.polyline;

      points.forEach((point) => {
        point[0] += worldPosDelta[0];
        point[1] += worldPosDelta[1];
        point[2] += worldPosDelta[2];
      });
      annotation.invalidated = true;
    } else {
      // Move mode - after double click, and mouse move to draw
      const { currentPoints } = eventDetail;
      const worldPos = currentPoints.world;

      data.handles.points[handleIndex] = [...worldPos];
      annotation.invalidated = true;
    }

    this.editData.hasMoved = true;

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);
  };

  cancel = (element: HTMLDivElement) => {
    // If it is not in mid-draw or mid-modify
    if (!this.isDrawing) {
      return;
    }

    this.isDrawing = false;
    this._deactivateDraw(element);
    this._deactivateModify(element);
    resetElementCursor(element);

    const { annotation, viewportIdsToRender, newAnnotation } = this.editData;

    if (newAnnotation) {
      removeAnnotation(annotation.annotationUID);
    }

    const enabledElement = getEnabledElement(element);
    const { renderingEngine } = enabledElement;

    triggerAnnotationRenderForViewportIds(renderingEngine, viewportIdsToRender);

    this.editData = null;
    this.scissors = null;
    return annotation.annotationUID;
  };

  /**
   * Triggers an annotation modified event.
   */
  triggerAnnotationModified = (
    annotation: LivewireContourAnnotation,
    enabledElement: Types.IEnabledElement
  ): void => {
    const { viewportId, renderingEngineId } = enabledElement;
    const eventType = Events.ANNOTATION_MODIFIED;

    const eventDetail: AnnotationModifiedEventDetail = {
      annotation,
      viewportId,
      renderingEngineId,
    };

    triggerEvent(eventTarget, eventType, eventDetail);
  };

  private _activateModify = (element) => {
    state.isInteractingWithTool = true;

    element.addEventListener(Events.MOUSE_UP, this._endCallback);
    element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.addEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.addEventListener(Events.TOUCH_END, this._endCallback);
    element.addEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.addEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  private _deactivateModify = (element) => {
    state.isInteractingWithTool = false;

    element.removeEventListener(Events.MOUSE_UP, this._endCallback);
    element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);

    element.removeEventListener(Events.TOUCH_END, this._endCallback);
    element.removeEventListener(Events.TOUCH_DRAG, this._dragCallback);
    element.removeEventListener(Events.TOUCH_TAP, this._endCallback);
  };

  private _activateDraw = (element) => {
    state.isInteractingWithTool = true;

    element.addEventListener(Events.MOUSE_MOVE, this._mouseMoveCallback);
    element.addEventListener(Events.MOUSE_DOWN, this._mouseDownCallback);
    element.addEventListener(
      Events.MOUSE_DOUBLE_CLICK,
      this._mouseDownCallback
    );

    element.addEventListener(Events.TOUCH_TAP, this._mouseDownCallback);
  };

  private _deactivateDraw = (element) => {
    state.isInteractingWithTool = false;

    element.removeEventListener(Events.MOUSE_MOVE, this._mouseMoveCallback);
    element.removeEventListener(Events.MOUSE_DOWN, this._mouseDownCallback);
    element.removeEventListener(
      Events.MOUSE_DOUBLE_CLICK,
      this._mouseDownCallback
    );

    element.removeEventListener(Events.TOUCH_TAP, this._mouseDownCallback);
  };

  /**
   * it is used to draw the circleROI annotation in each
   * request animation frame. It calculates the updated cached statistics if
   * data is invalidated and cache it.
   *
   * @param enabledElement - The Cornerstone's enabledElement.
   * @param svgDrawingHelper - The svgDrawingHelper providing the context for drawing.
   */
  renderAnnotation = (
    enabledElement: Types.IEnabledElement,
    svgDrawingHelper: SVGDrawingHelper
  ): boolean => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { worldToCanvas } = viewport;
    const { element } = viewport;

    // If rendering engine has been destroyed while rendering
    if (!viewport.getRenderingEngine()) {
      console.warn('Rendering Engine has been destroyed');
      return renderStatus;
    }

    let annotations = getAnnotations(this.getToolName(), element);

    if (!annotations?.length) {
      return renderStatus;
    }

    annotations = this.filterInteractableAnnotationsForElement(
      element,
      annotations
    );

    if (!annotations?.length) {
      return renderStatus;
    }

    // const targetId = this.getTargetId(viewport);
    const newAnnotation = this.editData?.newAnnotation;
    const styleSpecifier: StyleSpecifier = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: enabledElement.viewport.id,
    };

    // Update the annotation that is in editData (being edited)
    this._updateAnnotation(element, this.editData?.currentPath);

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i] as LivewireContourAnnotation;
      const { annotationUID, data, highlighted } = annotation;
      const { handles } = data;
      const { points, activeHandleIndex } = handles;

      styleSpecifier.annotationUID = annotationUID;

      const lineWidth = this.getStyle(
        'lineWidth',
        styleSpecifier,
        annotation
      ) as number;
      const lineDash = this.getStyle(
        'lineDash',
        styleSpecifier,
        annotation
      ) as string;
      const color = this.getStyle(
        'color',
        styleSpecifier,
        annotation
      ) as string;

      const canvasCoordinates = points.map((p) =>
        worldToCanvas(p)
      ) as Types.Point2[];

      let activeHandleCanvasCoords;

      if (!isAnnotationVisible(annotationUID)) {
        continue;
      }

      if (
        !isAnnotationLocked(annotation) &&
        !this.editData &&
        activeHandleIndex !== null
      ) {
        // Not locked or creating and hovering over handle, so render handle.
        activeHandleCanvasCoords = [canvasCoordinates[activeHandleIndex]];
      }

      if (activeHandleCanvasCoords || newAnnotation || highlighted) {
        const handleGroupUID = '0';
        drawHandlesSvg(
          svgDrawingHelper,
          annotationUID,
          handleGroupUID,
          canvasCoordinates,
          {
            color,
            lineDash,
            lineWidth,
            handleRadius: '3',
          }
        );
      }

      const canvasPolyline = data.polyline.map((worldPoint) =>
        viewport.worldToCanvas(worldPoint)
      );

      drawPolylineSvg(
        svgDrawingHelper,
        annotationUID,
        'polyline',
        canvasPolyline,
        {
          color,
          lineDash,
          lineWidth,
        }
      );

      renderStatus = true;
      annotation.invalidated = false;
    }

    return renderStatus;
  };

  private _updateAnnotation(
    element: HTMLDivElement,
    livewirePath: LivewirePath
  ) {
    if (!this.editData || !livewirePath) {
      return;
    }

    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;
    const { actor } = (<Types.IViewport>viewport).getDefaultActor();
    const vtkImageData = actor.getMapper().getInputData();
    const { pointArray: imagePoints } = livewirePath;
    const worldPolylinePoints: Types.Point3[] = [];
    const sliceIndex = 1; // TODO: change this for volume viewports

    for (let i = 0, len = imagePoints.length; i < len; i++) {
      const imagePoint = [imagePoints[i][0], imagePoints[i][1], sliceIndex];
      const worldPoint = csUtils.transformIndexToWorld(
        vtkImageData,
        imagePoint
      );
      worldPolylinePoints.push(worldPoint);
    }

    if (worldPolylinePoints.length > 1) {
      worldPolylinePoints.push([...worldPolylinePoints[0]]);
    }

    this.editData.annotation.data.polyline = worldPolylinePoints;
  }
}

LivewireContourTool.toolName = 'LivewireContour';
export default LivewireContourTool;
