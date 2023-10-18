import {
  eventTarget,
  VolumeViewport,
  StackViewport,
  Types,
  Enums,
  utilities,
  getEnabledElement,
  cache,
} from '@cornerstonejs/core';
import { ColorBar, ColorBarProps, ColorBarVOIRange } from './ColorBar';

const { Events } = Enums;
const DEFAULT_MULTIPLIER = 4;

export interface ViewportColorBarProps extends ColorBarProps {
  element: HTMLDivElement;
  volumeId?: string;
}

class ViewportColorBar extends ColorBar {
  private _element: HTMLDivElement;
  private _volumeId: string;

  constructor(props: ViewportColorBarProps) {
    super({
      ...props,
      range: ViewportColorBar._getRange(props.element, props.volumeId),
      voiRange: ViewportColorBar._getVOIRange(props.element, props.volumeId),
    });

    this._element = props.element;
    this._volumeId = props.volumeId;

    this.init();
    this._addCornerstoneEventListener();
  }

  public get element() {
    return this._element;
  }

  public get enabledElement() {
    return getEnabledElement(this._element);
  }

  protected init() {
    super.init();
    console.log('>>>>> init :: this', this);
  }

  protected getVOIMultipliers(): [number, number] {
    const { viewport } = this.enabledElement;
    // const {actor: volumeActor } = viewport.getActor(this._volumeId)
    const volume = cache.getVolume(this._volumeId);
    const { scaling } = volume;
    const isPreScaled = !!scaling && Object.keys(scaling).length > 0;
    const { Modality: modality } = volume.metadata;

    if (modality === 'PT') {
      const ptMultiplier = 1 / 5;

      return isPreScaled
        ? [ptMultiplier, ptMultiplier]
        : [DEFAULT_MULTIPLIER, DEFAULT_MULTIPLIER];
    }

    // eslint-disable-next-line
    console.log(
      `>>>>> volumeId (${modality}, ${isPreScaled}) :: ${this._volumeId.slice(
        -20
      )} :`,
      volume
    );

    return [DEFAULT_MULTIPLIER, DEFAULT_MULTIPLIER];
  }

  protected voiChanged(voiRange: ColorBarVOIRange) {
    super.voiChanged(voiRange);

    const { viewport } = this.enabledElement;

    if (viewport instanceof StackViewport) {
      viewport.setProperties({
        voiRange: voiRange,
      });
      viewport.render();
    } else if (viewport instanceof VolumeViewport) {
      const { _volumeId: volumeId } = this;
      const viewportsContainingVolumeUID = utilities.getViewportsWithVolumeId(
        volumeId,
        viewport.renderingEngineId
      );

      // eslint-disable-next-line
      console.log(
        `>>>>> voiChanged :: ${volumeId.slice(-12)} :: voiRange:`,
        voiRange
      );
      viewport.setProperties({ voiRange }, volumeId);
      viewportsContainingVolumeUID.forEach((vp) => vp.render());
    }
  }

  private static _getRange(element, volumeId) {
    const defaultValue = { lower: -1000, upper: 1000 };
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;

    const actor = volumeId
      ? viewport.getActor(volumeId)
      : viewport.getDefaultActor();

    if (!actor) {
      return defaultValue;
    }

    const imageData = actor.actor.getMapper().getInputData();
    const range = imageData.getPointData().getScalars().getRange();

    // console.log(`>>>>> range :: ${volumeId.slice(-20)} :: `, range);

    return range[0] === 0 && range[1] === 0
      ? defaultValue
      : { lower: range[0], upper: range[1] };
  }

  private static _getVOIRange(element, volumeId) {
    const defaultValue = { lower: -1000, upper: 1000 };
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;

    const actor = volumeId
      ? viewport.getActor(volumeId)
      : viewport.getDefaultActor();

    if (!actor) {
      return { lower: -1000, upper: 1000 };
    }

    const voiRange = actor.actor
      .getProperty()
      .getRGBTransferFunction(0)
      .getRange();

    return voiRange[0] === 0 && voiRange[1] === 0
      ? defaultValue
      : { lower: voiRange[0], upper: voiRange[1] };
  }

  private _imageVolumeModifiedCallback = (
    evt: Types.EventTypes.ImageVolumeModifiedEvent
  ) => {
    const { volumeId } = evt.detail.imageVolume;

    if (volumeId !== this._volumeId) {
      return;
    }

    const { _element: element } = this;

    this.range = ViewportColorBar._getRange(element, volumeId);
  };

  private _viewportVOIModifiedCallback = (
    evt: Types.EventTypes.VoiModifiedEvent
  ) => {
    const { viewportId, volumeId, range } = evt.detail;
    const { viewport } = this.enabledElement;

    if (viewportId != viewport.id || volumeId !== this._volumeId) {
      return;
    }

    // console.log('>>>>> voiModifiedCallback :: evt:', evt);
    // eslint-disable-next-line
    console.log(
      `>>>>> voiModifiedCallback :: ${volumeId.slice(-12)} :: voiRange:`,
      evt.detail.range
    );
    this.voiRange = range;
  };

  private _addCornerstoneEventListener() {
    const { _element: element } = this;

    eventTarget.addEventListener(
      Events.IMAGE_VOLUME_MODIFIED,
      this._imageVolumeModifiedCallback
    );

    element.addEventListener(
      Events.VOI_MODIFIED,
      this._viewportVOIModifiedCallback
    );
  }
}

export { ViewportColorBar as default, ViewportColorBar };
