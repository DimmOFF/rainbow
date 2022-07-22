import React from 'react';
import { Source } from 'react-native-fast-image';
import { ButtonPressAnimation } from '../../animations';
import CheckmarkCircledIcon from '../../icons/svg/CheckmarkCircledIcon';
import WarningIcon from '../../icons/svg/WarningIcon';
import Caret from '@rainbow-me/assets/family-dropdown-arrow.png';
import { Box, Inline, Stack, Text } from '@rainbow-me/design-system';
import { ImgixImage } from '@rainbow-me/images';
import { useTheme } from '@rainbow-me/theme';

interface ImageIconProps {
  size?: number;
  source: StaticImageData;
}

const ImageIcon = ({ size = 60, source }: ImageIconProps) => (
  <Box
    as={ImgixImage}
    borderRadius={size / 2}
    height={{ custom: size }}
    marginLeft={{ custom: -11 }}
    marginRight={{ custom: -11 }}
    marginTop={{ custom: 8 }}
    source={source as Source}
    width={{ custom: size }}
  />
);

interface TextIconProps {
  icon: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';
  disabled?: boolean;
  isLink?: boolean;
  colorOverride?: string;
}

const TextIcon = ({
  colorOverride,
  icon,
  weight = 'semibold',
  disabled,
  isLink,
}: TextIconProps) => (
  <Text
    color={
      colorOverride
        ? { custom: colorOverride }
        : disabled
        ? 'secondary60'
        : isLink
        ? 'action'
        : 'primary'
    }
    containsEmoji
    size="18px"
    weight={weight}
  >
    {icon}
  </Text>
);

interface SelectionProps {
  children: React.ReactNode;
}

const Selection = ({ children }: SelectionProps) => (
  <Text color="secondary60" size="18px" weight="semibold">
    {children}
  </Text>
);

type StatusType = 'complete' | 'incomplete' | 'warning' | 'selected';

interface StatusIconProps {
  status: StatusType;
}

const StatusIcon = ({ status }: StatusIconProps) => {
  const { colors, isDarkMode } = useTheme();
  const statusColors: { [key in StatusType]: string } = {
    complete: colors.green,
    incomplete: colors.alpha(colors.blueGreyDark, 0.5),
    selected: colors.appleBlue,
    warning: colors.orangeLight,
  };
  return (
    <Box
      as={status === 'warning' ? WarningIcon : CheckmarkCircledIcon}
      backgroundColor={statusColors[status]}
      color={statusColors[status]}
      colors={colors}
      fillColor={colors.white}
      shadowColor={isDarkMode ? colors.shadow : statusColors[status]}
      shadowOffset={{
        height: 4,
        width: 0,
      }}
      shadowOpacity={0.4}
      shadowRadius={6}
    />
  );
};

interface TitleProps {
  text: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';
  disabled?: boolean;
  isLink?: boolean;
}

const Title = ({ text, weight = 'semibold', disabled, isLink }: TitleProps) => (
  <Text
    color={disabled ? 'secondary60' : isLink ? 'action' : 'primary'}
    containsEmoji
    size="18px"
    weight={weight}
  >
    {text}
  </Text>
);

interface LabelProps {
  text: string;
  warn?: boolean;
}

const Label = ({ text, warn }: LabelProps) => {
  const { colors } = useTheme();
  return (
    <Text
      color={warn ? { custom: colors.orangeLight } : 'secondary60'}
      size="14px"
      weight="medium"
    >
      {text}
    </Text>
  );
};

interface MenuItemProps {
  rightComponent?: React.ReactNode;
  leftComponent?: React.ReactNode;
  size: 'medium' | 'large';
  iconPadding?: 'small' | 'medium' | 'large';
  hasRightArrow?: boolean;
  onPress?: () => void;
  titleComponent: React.ReactNode;
  labelComponent?: React.ReactNode;
  disabled?: boolean;
  hasChevron?: boolean;
}

const MenuItem = ({
  hasRightArrow,
  onPress,
  leftComponent,
  rightComponent,
  size,
  iconPadding,
  titleComponent,
  labelComponent,
  disabled,
  hasChevron,
}: MenuItemProps) => {
  const { colors } = useTheme();
  const space =
    iconPadding === 'small'
      ? 6
      : iconPadding === 'medium'
      ? 10
      : iconPadding === 'large'
      ? 17
      : 0;

  const Item = () => (
    <Box
      height={{ custom: size === 'large' ? 60 : 52 }}
      justifyContent="center"
      paddingHorizontal={{ custom: 16 }}
      width="full"
    >
      <Inline alignHorizontal="justify" alignVertical="center">
        <Inline alignVertical="center" space={{ custom: space }}>
          {leftComponent}
          <Stack space="8px">
            {titleComponent}
            {labelComponent}
          </Stack>
        </Inline>
        <Inline alignVertical="center" space={{ custom: 9 }}>
          {rightComponent}
          {hasRightArrow && (
            <Box
              as={ImgixImage}
              height={{ custom: 15 }}
              source={Caret as Source}
              tintColor={colors.blueGreyDark60}
              width={{ custom: 5.83 }}
            />
          )}
          {hasChevron && (
            <Text color="secondary60" size="18px" weight="regular">
              􀆏
            </Text>
          )}
        </Inline>
      </Inline>
    </Box>
  );

  return disabled ? (
    <Item />
  ) : (
    <ButtonPressAnimation onPress={onPress} scaleTo={0.96}>
      <Item />
    </ButtonPressAnimation>
  );
};

MenuItem.ImageIcon = ImageIcon;
MenuItem.Label = Label;
MenuItem.Selection = Selection;
MenuItem.StatusIcon = StatusIcon;
MenuItem.TextIcon = TextIcon;
MenuItem.Title = Title;

export default MenuItem;
