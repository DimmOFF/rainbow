import * as React from 'react';
import FastImage, { FastImageProps, Source } from 'react-native-fast-image';

import { ImgOptions, maybeSignSource } from '../../handlers/imgix';

export type TransformationImageProps = FastImageProps & {
  readonly Component?: React.ElementType;
  readonly size?: Number;
};

// Here we're emulating the pattern used in react-native-fast-image:
// https://github.com/DylanVann/react-native-fast-image/blob/0439f7190f141e51a391c84890cdd8a7067c6ad3/src/index.tsx#L146
type HiddenTransformationImageProps = {
  forwardedRef: React.Ref<any>;
  size?: Number;
  fm?: String;
};
type MergedTransformationImageProps = TransformationImageProps &
  HiddenTransformationImageProps;

// TransformationImage must be a class Component to support Animated.createAnimatedComponent.
class TransformationImage extends React.PureComponent<
  MergedTransformationImageProps,
  TransformationImageProps
> {
  static getDerivedStateFromProps(props: MergedTransformationImageProps) {
    const { source, size, fm } = props;
    const options = {
      ...(fm && { fm: fm }),
      ...(size && {
        h: size,
        w: size,
      }),
    };

    return {
      source:
        !!source && typeof source === 'object'
          ? maybeSignSource(source, options as ImgOptions)
          : source,
    };
  }

  render() {
    const { Component: maybeComponent, ...props } = this.props;
    // Use the local state as the signing source, as opposed to the prop directly.
    // (The source prop may point to an untrusted URL.)
    const { source } = this.state;
    const Component = maybeComponent || FastImage;
    return <Component {...props} source={source} />;
  }
}

const preload = (sources: Source[], size?: Number, fm?: String): void => {
  if (sources.length) {
    const options = {
      ...(fm && { fm: fm }),
      ...(size && {
        h: size,
        w: size,
      }),
    } as ImgOptions;
    return FastImage.preload(
      sources.map(source => maybeSignSource(source, options))
    );
  }
  return;
};

const getCachePath = (source: Source) =>
  FastImage.getCachePath(maybeSignSource(source));

const TransformationImageWithForwardRef = React.forwardRef(
  (props: TransformationImageProps, ref: React.Ref<any>) => (
    <TransformationImage forwardedRef={ref} {...props} />
  )
);

const {
  cacheControl,
  clearDiskCache,
  clearMemoryCache,
  contextTypes,
  priority,
  resizeMode,
} = FastImage;

export default Object.assign(TransformationImageWithForwardRef, {
  cacheControl,
  clearDiskCache,
  clearMemoryCache,
  contextTypes,
  getCachePath,
  preload,
  priority,
  resizeMode,
});