import { Provider } from '@ethersproject/providers';
import { useRoute } from '@react-navigation/native';
import lang from 'i18n-js';
import { isEmpty, isEqual } from 'lodash';
import React, {
  MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import equal from 'react-fast-compare';
import {
  InteractionManager,
  Keyboard,
  NativeModules,
  TextInput,
} from 'react-native';
import { useAndroidBackHandler } from 'react-navigation-backhandler';
import { useDispatch, useSelector } from 'react-redux';
import { useDebounce } from 'use-debounce/lib';
import { useMemoOne } from 'use-memo-one';
import { dismissingScreenListener } from '../../shim';
import {
  AnimatedExchangeFloatingPanels,
  ConfirmExchangeButton,
  DepositInfo,
  ExchangeDetailsRow,
  ExchangeHeader,
  ExchangeInputField,
  ExchangeNotch,
  ExchangeOutputField,
} from '../components/exchange';
import { FloatingPanel } from '../components/floating-panels';
import { GasSpeedButton } from '../components/gas';
import { Column, KeyboardFixedOpenLayout } from '../components/layout';
import { delayNext } from '../hooks/useMagicAutofocus';
import config from '../model/config';
import { WrappedAlert as Alert } from '@/helpers/alert';
import { analytics } from '@rainbow-me/analytics';
import { Box, Row, Rows } from '@rainbow-me/design-system';
import { AssetType } from '@rainbow-me/entities';
import { getProviderForNetwork } from '@rainbow-me/handlers/web3';
import {
  ExchangeModalTypes,
  isKeyboardOpen,
  Network,
} from '@rainbow-me/helpers';
import { KeyboardType } from '@rainbow-me/helpers/keyboardTypes';
import { divide, greaterThan, multiply } from '@rainbow-me/helpers/utilities';
import {
  useAccountSettings,
  useCurrentNonce,
  useDimensions,
  useGas,
  usePrevious,
  usePriceImpactDetails,
  useSwapCurrencies,
  useSwapCurrencyHandlers,
  useSwapDerivedOutputs,
  useSwapInputHandlers,
  useSwapInputRefs,
  useSwapIsSufficientBalance,
  useSwapSettings,
} from '@rainbow-me/hooks';
import { loadWallet } from '@rainbow-me/model/wallet';
import { useNavigation } from '@rainbow-me/navigation';
import {
  executeRap,
  getSwapRapEstimationByType,
  getSwapRapTypeByExchangeType,
} from '@rainbow-me/raps';
import {
  swapClearState,
  TypeSpecificParameters,
  updateSwapSlippage,
  updateSwapTypeDetails,
} from '@rainbow-me/redux/swap';
import { ETH_ADDRESS, ethUnits } from '@rainbow-me/references';
import Routes from '@rainbow-me/routes';
import styled from '@rainbow-me/styled-components';
import { position } from '@rainbow-me/styles';
import { ethereumUtils } from '@rainbow-me/utils';
import { useEthUSDPrice } from '@rainbow-me/utils/ethereumUtils';
import logger from 'logger';

export const DEFAULT_SLIPPAGE_BIPS = {
  [Network.mainnet]: 100,
  [Network.polygon]: 200,
  [Network.optimism]: 200,
  [Network.arbitrum]: 200,
  [Network.goerli]: 100,
  [Network.ropsten]: 100,
  [Network.rinkeby]: 100,
  [Network.kovan]: 100,
};

export const getDefaultSlippageFromConfig = (network: Network) => {
  const configSlippage = (config.default_slippage_bips as unknown) as {
    [network: string]: number;
  };
  const slippage =
    (configSlippage?.[network] as {}) ?? DEFAULT_SLIPPAGE_BIPS[network] ?? 100;
  return slippage;
};
const NOOP = () => null;

const FloatingPanels = AnimatedExchangeFloatingPanels;

const Wrapper = KeyboardFixedOpenLayout;

const InnerWrapper = styled(Column).attrs({
  direction: 'column',
})({
  ...position.sizeAsObject('100%'),
});

const getInputHeaderTitle = (
  type: 'deposit' | 'swap' | 'withdrawal',
  defaultInputAsset: Asset
) => {
  switch (type) {
    case ExchangeModalTypes.deposit:
      return lang.t('swap.modal_types.deposit');
    case ExchangeModalTypes.withdrawal:
      return lang.t('swap.modal_types.withdraw_symbol', {
        symbol: defaultInputAsset.symbol,
      });
    default:
      return lang.t('swap.modal_types.swap');
  }
};

const getShowOutputField = (type: 'deposit' | 'swap' | 'withdrawal') => {
  switch (type) {
    case ExchangeModalTypes.deposit:
    case ExchangeModalTypes.withdrawal:
      return false;
    default:
      return true;
  }
};

interface Asset {
  address: string;
  balance: { amount: string; display: string };
  decimals: number;
  icon_url: string;
  id: string;
  implementations: {
    [network: string]: { address: string; decimals: number };
  }[];
  isNativeAsset: boolean;
  isRainbowCurated: boolean;
  isVerified: boolean;
  is_displayable: boolean;
  is_verified: boolean;
  name: string;
  native: {
    balance: { amount: string; display: string };
    change: string;
    price: { amount: number; display: string };
  };
  price: { changed_at: number; relative_change_24h: number; value: number };
  symbol: string;
  type: string;
  uniqueId: string;
}

interface ExchangeModalProps {
  fromDiscover: boolean;
  ignoreInitialTypeCheck?: boolean;
  testID: string;
  type: 'deposit' | 'swap' | 'withdrawal';
  typeSpecificParams: TypeSpecificParameters;
}

export default function ExchangeModal({
  fromDiscover,
  ignoreInitialTypeCheck,
  testID,
  type,
  typeSpecificParams,
}: ExchangeModalProps) {
  const { isSmallPhone, isSmallAndroidPhone } = useDimensions();
  const dispatch = useDispatch();
  const {
    slippageInBips,
    maxInputUpdate,
    flipCurrenciesUpdate,
  } = useSwapSettings();
  const {
    params: { inputAsset: defaultInputAsset, outputAsset: defaultOutputAsset },
  } = useRoute<{
    key: string;
    name: string;
    params: { inputAsset: Asset; outputAsset: Asset };
  }>();

  useLayoutEffect(() => {
    dispatch(updateSwapTypeDetails(type, typeSpecificParams));
  }, [dispatch, type, typeSpecificParams]);

  const title = getInputHeaderTitle(type, defaultInputAsset);
  const showOutputField = getShowOutputField(type);
  const priceOfEther = useEthUSDPrice();
  const genericAssets = useSelector<
    { data: { genericAssets: Asset[] } },
    Asset[]
  >(({ data: { genericAssets } }) => genericAssets);

  const {
    navigate,
    setParams,
    dangerouslyGetParent,
    addListener,
  } = useNavigation();

  // if the default input is on a different network than
  // we want to update the output to be on the same, if its not available -> null
  const defaultOutputAssetOverride = useMemo(() => {
    let newOutput = defaultOutputAsset;

    if (
      defaultInputAsset &&
      defaultOutputAsset &&
      defaultInputAsset.type !== defaultOutputAsset.type
    ) {
      if (
        defaultOutputAsset?.implementations?.[
          defaultInputAsset?.type === AssetType.token
            ? 'ethereum'
            : defaultInputAsset?.type
        ]?.address
      ) {
        if (defaultInputAsset.type !== Network.mainnet) {
          newOutput.mainnet_address = defaultOutputAsset.address;
        }

        newOutput.address =
          defaultOutputAsset.implementations[defaultInputAsset?.type].address;
        newOutput.type = defaultInputAsset.type;
        newOutput.uniqueId =
          newOutput.type === Network.mainnet
            ? defaultOutputAsset?.address
            : `${defaultOutputAsset?.address}_${defaultOutputAsset?.type}`;
        return newOutput;
      } else {
        return null;
      }
    } else {
      return newOutput;
    }
  }, [defaultInputAsset, defaultOutputAsset]);

  const isDeposit = type === ExchangeModalTypes.deposit;
  const isWithdrawal = type === ExchangeModalTypes.withdrawal;
  const isSavings = isDeposit || isWithdrawal;
  const {
    selectedGasFee,
    gasFeeParamsBySpeed,
    startPollingGasFees,
    stopPollingGasFees,
    updateDefaultGasLimit,
    updateTxFee,
    txNetwork,
    isGasReady,
  } = useGas();
  const {
    accountAddress,
    flashbotsEnabled,
    nativeCurrency,
  } = useAccountSettings();

  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<Provider>();

  const prevGasFeesParamsBySpeed = usePrevious(gasFeeParamsBySpeed);
  const prevTxNetwork = usePrevious(txNetwork);

  useAndroidBackHandler(() => {
    navigate(Routes.WALLET_SCREEN);
    return true;
  });

  const { inputCurrency, outputCurrency } = useSwapCurrencies();

  const {
    handleFocus,
    inputFieldRef,
    lastFocusedInputHandle,
    setLastFocusedInputHandle,
    nativeFieldRef,
    outputFieldRef,
  } = useSwapInputRefs();

  const {
    updateInputAmount,
    updateMaxInputAmount,
    updateNativeAmount,
    updateOutputAmount,
  } = useSwapInputHandlers();

  const chainId = useMemo(() => {
    if (inputCurrency?.type || outputCurrency?.type) {
      return ethereumUtils.getChainIdFromType(
        inputCurrency?.type! ?? outputCurrency?.type!
      );
    }

    return 1;
  }, [inputCurrency, outputCurrency]);

  const currentNetwork = useMemo(
    () => ethereumUtils.getNetworkFromChainId(chainId),
    [chainId]
  );

  const {
    flipCurrencies,
    navigateToSelectInputCurrency,
    navigateToSelectOutputCurrency,
  } = useSwapCurrencyHandlers({
    currentNetwork,
    defaultInputAsset,
    defaultOutputAsset: defaultOutputAssetOverride,
    fromDiscover,
    ignoreInitialTypeCheck,
    inputFieldRef,
    lastFocusedInputHandle,
    nativeFieldRef,
    outputFieldRef,
    setLastFocusedInputHandle,
    title,
    type,
  });

  const defaultGasLimit = useMemo(() => {
    const basicSwap = ethereumUtils.getBasicSwapGasLimit(Number(chainId));
    return isDeposit
      ? ethUnits.basic_deposit
      : isWithdrawal
      ? ethUnits.basic_withdrawal
      : basicSwap;
  }, [chainId, isDeposit, isWithdrawal]);

  const getNextNonce = useCurrentNonce(accountAddress, currentNetwork);

  useEffect(() => {
    const getProvider = async () => {
      const p = await getProviderForNetwork(currentNetwork);
      setCurrentProvider(p);
    };
    getProvider();
  }, [currentNetwork]);

  const {
    result: {
      derivedValues: { inputAmount, nativeAmount, outputAmount },
      displayValues: {
        inputAmountDisplay,
        outputAmountDisplay,
        nativeAmountDisplay,
      },
      tradeDetails,
    },
    loading,
    resetSwapInputs,
    insufficientLiquidity,
  } = useSwapDerivedOutputs(Number(chainId), type);

  const lastTradeDetails = usePrevious(tradeDetails);
  const isSufficientBalance = useSwapIsSufficientBalance(inputAmount);

  const {
    isHighPriceImpact,
    outputPriceValue,
    priceImpactColor,
    priceImpactNativeAmount,
    priceImpactPercentDisplay,
  } = usePriceImpactDetails(
    inputAmount,
    outputAmount,
    inputCurrency,
    outputCurrency,
    currentNetwork,
    loading
  );
  const [debouncedIsHighPriceImpact] = useDebounce(isHighPriceImpact, 1000);
  const swapSupportsFlashbots = currentNetwork === Network.mainnet;
  const flashbots = swapSupportsFlashbots && flashbotsEnabled;

  const isDismissing = useRef(false);
  useEffect(() => {
    if (ios) {
      return;
    }
    ((dismissingScreenListener.current as unknown) as () => void) = () => {
      Keyboard.dismiss();
      isDismissing.current = true;
    };
    const unsubscribe = (
      dangerouslyGetParent()?.dangerouslyGetParent()?.addListener || addListener
    )('transitionEnd', ({ data: { closing } }) => {
      if (!closing && isDismissing.current) {
        isDismissing.current = false;
        ((lastFocusedInputHandle as unknown) as MutableRefObject<TextInput>)?.current?.focus();
      }
    });
    return () => {
      unsubscribe();
      dismissingScreenListener.current = undefined;
    };
  }, [addListener, dangerouslyGetParent, lastFocusedInputHandle]);

  useEffect(() => {
    let slippage = DEFAULT_SLIPPAGE_BIPS?.[currentNetwork];
    if (config.default_slippage_bips?.[currentNetwork]) {
      slippage = config.default_slippage_bips?.[currentNetwork];
    }
    slippage && dispatch(updateSwapSlippage(slippage));
  }, [currentNetwork, dispatch]);

  useEffect(() => {
    return () => {
      dispatch(swapClearState());
      resetSwapInputs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCustomGasBlur = useCallback(() => {
    ((lastFocusedInputHandle as unknown) as MutableRefObject<TextInput>)?.current?.focus();
  }, [lastFocusedInputHandle]);

  const updateGasLimit = useCallback(async () => {
    try {
      const swapParams = {
        chainId,
        inputAmount: inputAmount!,
        outputAmount: outputAmount!,
        provider: currentProvider!,
        tradeDetails: tradeDetails!,
      };

      const rapType = getSwapRapTypeByExchangeType(type);
      const gasLimit = await getSwapRapEstimationByType(rapType, swapParams);
      if (gasLimit) {
        if (currentNetwork === Network.optimism) {
          if (tradeDetails) {
            const l1GasFeeOptimism = await ethereumUtils.calculateL1FeeOptimism(
              {
                data: tradeDetails.data,
                from: tradeDetails.from,
                to: tradeDetails.to ?? null,
                value: tradeDetails.value,
              },
              currentProvider!
            );
            updateTxFee(gasLimit, null, l1GasFeeOptimism);
          } else {
            updateTxFee(
              gasLimit,
              null,
              ethUnits.default_l1_gas_fee_optimism_swap
            );
          }
        } else {
          updateTxFee(gasLimit, null);
        }
      }
    } catch (error) {
      updateTxFee(defaultGasLimit, null);
    }
  }, [
    chainId,
    currentNetwork,
    currentProvider,
    defaultGasLimit,
    inputAmount,
    outputAmount,
    tradeDetails,
    type,
    updateTxFee,
  ]);

  useEffect(() => {
    if (tradeDetails && !equal(tradeDetails, lastTradeDetails)) {
      updateGasLimit();
    }
  }, [lastTradeDetails, tradeDetails, updateGasLimit]);

  // Set default gas limit
  useEffect(() => {
    if (isEmpty(prevGasFeesParamsBySpeed) && !isEmpty(gasFeeParamsBySpeed)) {
      updateTxFee(defaultGasLimit, null);
    }
  }, [
    defaultGasLimit,
    gasFeeParamsBySpeed,
    prevGasFeesParamsBySpeed,
    updateTxFee,
  ]);
  // Update gas limit
  useEffect(() => {
    if (
      !isGasReady ||
      (!prevTxNetwork && txNetwork !== prevTxNetwork) ||
      (!isEmpty(gasFeeParamsBySpeed) &&
        !isEqual(gasFeeParamsBySpeed, prevGasFeesParamsBySpeed))
    ) {
      updateGasLimit();
    }
  }, [
    gasFeeParamsBySpeed,
    isGasReady,
    prevGasFeesParamsBySpeed,
    prevTxNetwork,
    txNetwork,
    updateGasLimit,
  ]);

  // Liten to gas prices, Uniswap reserves updates
  useEffect(() => {
    updateDefaultGasLimit(defaultGasLimit);
    InteractionManager.runAfterInteractions(() => {
      // Start polling in the current network
      startPollingGasFees(currentNetwork, flashbots);
    });
    return () => {
      stopPollingGasFees();
    };
  }, [
    defaultGasLimit,
    currentNetwork,
    startPollingGasFees,
    stopPollingGasFees,
    updateDefaultGasLimit,
    flashbots,
  ]);

  const handlePressMaxBalance = useCallback(async () => {
    updateMaxInputAmount();
  }, [updateMaxInputAmount]);

  const checkGasVsOutput = async (gasPrice: number, outputPrice: string) => {
    if (greaterThan(outputPrice, 0) && greaterThan(gasPrice, outputPrice)) {
      const res = new Promise(resolve => {
        Alert.alert(
          lang.t('swap.warning.cost.are_you_sure_title'),
          lang.t('swap.warning.cost.this_transaction_will_cost_you_more'),
          [
            {
              onPress: () => {
                resolve(false);
              },
              text: lang.t('button.proceed_anyway'),
            },
            {
              onPress: () => {
                resolve(true);
              },
              style: 'cancel',
              text: lang.t('button.cancel'),
            },
          ]
        );
      });
      return res;
    } else {
      return false;
    }
  };

  const submit = useCallback(
    async amountInUSD => {
      setIsAuthorizing(true);
      let NotificationManager = ios ? NativeModules.NotificationManager : null;
      try {
        const wallet = await loadWallet();
        if (!wallet) {
          setIsAuthorizing(false);
          logger.sentry(`aborting ${type} due to missing wallet`);
          return false;
        }

        const callback = (success = false, errorMessage = null) => {
          setIsAuthorizing(false);
          if (success) {
            setParams({ focused: false });
            navigate(Routes.PROFILE_SCREEN);
          } else if (errorMessage) {
            Alert.alert(errorMessage);
          }
        };
        logger.log('[exchange - handle submit] rap');
        const nonce = await getNextNonce();
        const swapParameters = {
          chainId,
          flashbots,
          inputAmount,
          nonce,
          outputAmount,
          tradeDetails,
        };
        const rapType = getSwapRapTypeByExchangeType(type);
        await executeRap(wallet, rapType, swapParameters, callback);
        logger.log('[exchange - handle submit] executed rap!');
        const slippage = slippageInBips / 100;
        analytics.track(`Completed ${type}`, {
          aggregator: tradeDetails?.source || '',
          amountInUSD,
          inputTokenAddress: inputCurrency?.address || '',
          inputTokenName: inputCurrency?.name || '',
          inputTokenSymbol: inputCurrency?.symbol || '',
          isHighPriceImpact: debouncedIsHighPriceImpact,
          liquiditySources: JSON.stringify(tradeDetails?.protocols || []),
          network: currentNetwork,
          outputTokenAddress: outputCurrency?.address || '',
          outputTokenName: outputCurrency?.name || '',
          outputTokenSymbol: outputCurrency?.symbol || '',
          priceImpact: priceImpactPercentDisplay,
          slippage: isNaN(slippage) ? 'Error calculating slippage.' : slippage,
          type,
        });
        // Tell iOS we finished running a rap (for tracking purposes)
        NotificationManager?.postNotification('rapCompleted');
        return true;
      } catch (error) {
        setIsAuthorizing(false);
        logger.log('[exchange - handle submit] error submitting swap', error);
        setParams({ focused: false });
        navigate(Routes.WALLET_SCREEN);
        return false;
      }
    },
    [
      chainId,
      currentNetwork,
      debouncedIsHighPriceImpact,
      flashbots,
      getNextNonce,
      inputAmount,
      inputCurrency?.address,
      inputCurrency?.name,
      inputCurrency?.symbol,
      navigate,
      outputAmount,
      outputCurrency?.address,
      outputCurrency?.name,
      outputCurrency?.symbol,
      priceImpactPercentDisplay,
      setParams,
      slippageInBips,
      tradeDetails,
      type,
    ]
  );

  const handleSubmit = useCallback(async () => {
    let amountInUSD = '0';
    let NotificationManager = ios ? NativeModules.NotificationManager : null;
    try {
      // Tell iOS we're running a rap (for tracking purposes)
      NotificationManager?.postNotification('rapInProgress');
      if (nativeCurrency === 'usd') {
        amountInUSD = nativeAmount!;
      } else {
        const ethPriceInNativeCurrency =
          genericAssets[ETH_ADDRESS]?.price?.value ?? 0;
        const tokenPriceInNativeCurrency =
          genericAssets[inputCurrency?.address]?.price?.value ?? 0;
        const tokensPerEth = divide(
          tokenPriceInNativeCurrency,
          ethPriceInNativeCurrency
        );
        const inputTokensInEth = multiply(tokensPerEth, inputAmount!);
        amountInUSD = multiply(priceOfEther, inputTokensInEth);
      }
    } catch (e) {
      logger.log('error getting the swap amount in USD price', e);
    } finally {
      const slippage = slippageInBips / 100;
      analytics.track(`Submitted ${type}`, {
        aggregator: tradeDetails?.source || '',
        amountInUSD,
        inputTokenAddress: inputCurrency?.address || '',
        inputTokenName: inputCurrency?.name || '',
        inputTokenSymbol: inputCurrency?.symbol || '',
        isHighPriceImpact: debouncedIsHighPriceImpact,
        liquiditySources: JSON.stringify(tradeDetails?.protocols || []),
        network: currentNetwork,
        outputTokenAddress: outputCurrency?.address || '',
        outputTokenName: outputCurrency?.name || '',
        outputTokenSymbol: outputCurrency?.symbol || '',
        priceImpact: priceImpactPercentDisplay,
        slippage: isNaN(slippage) ? 'Error caclulating slippage.' : slippage,
        type,
      });
    }

    const outputInUSD = multiply(outputPriceValue!, outputAmount!);
    const gasPrice = selectedGasFee?.gasFee?.maxFee?.native?.value?.amount;
    const cancelTransaction = await checkGasVsOutput(gasPrice, outputInUSD);

    if (cancelTransaction) {
      return false;
    }
    try {
      return await submit(amountInUSD);
    } catch (e) {
      return false;
    }
  }, [
    outputPriceValue,
    outputAmount,
    selectedGasFee?.gasFee?.maxFee?.native?.value?.amount,
    submit,
    nativeCurrency,
    nativeAmount,
    genericAssets,
    inputCurrency?.address,
    inputCurrency?.name,
    inputCurrency?.symbol,
    inputAmount,
    priceOfEther,
    type,
    tradeDetails?.source,
    tradeDetails?.protocols,
    debouncedIsHighPriceImpact,
    currentNetwork,
    outputCurrency?.address,
    outputCurrency?.name,
    outputCurrency?.symbol,
    priceImpactPercentDisplay,
    slippageInBips,
  ]);

  const confirmButtonProps = useMemoOne(
    () => ({
      currentNetwork,
      disabled:
        !Number(inputAmount) || (!loading && !tradeDetails && !isSavings),
      inputAmount,
      insufficientLiquidity,
      isAuthorizing,
      isHighPriceImpact: debouncedIsHighPriceImpact,
      isSufficientBalance,
      loading,
      onSubmit: handleSubmit,
      tradeDetails,
      type,
    }),
    [
      currentNetwork,
      loading,
      handleSubmit,
      inputAmount,
      isAuthorizing,
      debouncedIsHighPriceImpact,
      testID,
      tradeDetails,
      type,
      insufficientLiquidity,
      isSufficientBalance,
    ]
  );

  const navigateToSwapSettingsSheet = useCallback(() => {
    android && Keyboard.dismiss();
    const lastFocusedInputHandleTemporary = lastFocusedInputHandle.current;
    android && (lastFocusedInputHandle.current = null);
    inputFieldRef?.current?.blur();
    outputFieldRef?.current?.blur();
    nativeFieldRef?.current?.blur();
    const internalNavigate = () => {
      delayNext();
      android && Keyboard.removeListener('keyboardDidHide', internalNavigate);
      setParams({ focused: false });
      navigate(Routes.SWAP_SETTINGS_SHEET, {
        asset: outputCurrency,
        network: currentNetwork,
        restoreFocusOnSwapModal: () => {
          android &&
            (lastFocusedInputHandle.current = lastFocusedInputHandleTemporary);
          setParams({ focused: true });
        },
        swapSupportsFlashbots,
        type: 'swap_settings',
      });
      analytics.track('Opened Swap Settings');
    };
    ios || !isKeyboardOpen()
      ? internalNavigate()
      : Keyboard.addListener('keyboardDidHide', internalNavigate);
  }, [
    lastFocusedInputHandle,
    inputFieldRef,
    outputFieldRef,
    nativeFieldRef,
    setParams,
    navigate,
    outputCurrency,
    currentNetwork,
    swapSupportsFlashbots,
  ]);

  const navigateToSwapDetailsModal = useCallback(() => {
    android && Keyboard.dismiss();
    const lastFocusedInputHandleTemporary = lastFocusedInputHandle.current;
    android && (lastFocusedInputHandle.current = null);
    inputFieldRef?.current?.blur();
    outputFieldRef?.current?.blur();
    nativeFieldRef?.current?.blur();
    const internalNavigate = () => {
      android && Keyboard.removeListener('keyboardDidHide', internalNavigate);
      setParams({ focused: false });
      navigate(Routes.SWAP_DETAILS_SHEET, {
        confirmButtonProps,
        currentNetwork,
        flashbotTransaction: flashbots,
        restoreFocusOnSwapModal: () => {
          android &&
            (lastFocusedInputHandle.current = lastFocusedInputHandleTemporary);
          setParams({ focused: true });
        },
        type: 'swap_details',
      });
      analytics.track('Opened Swap Details modal', {
        inputTokenAddress: inputCurrency?.address || '',
        inputTokenName: inputCurrency?.name || '',
        inputTokenSymbol: inputCurrency?.symbol || '',
        outputTokenAddress: outputCurrency?.address || '',
        outputTokenName: outputCurrency?.name || '',
        outputTokenSymbol: outputCurrency?.symbol || '',
        type,
      });
    };
    ios || !isKeyboardOpen()
      ? internalNavigate()
      : Keyboard.addListener('keyboardDidHide', internalNavigate);
  }, [
    confirmButtonProps,
    currentNetwork,
    flashbots,
    inputCurrency?.address,
    inputCurrency?.name,
    inputCurrency?.symbol,
    inputFieldRef,
    lastFocusedInputHandle,
    nativeFieldRef,
    navigate,
    outputCurrency?.address,
    outputCurrency?.name,
    outputCurrency?.symbol,
    outputFieldRef,
    setParams,
    type,
  ]);

  const handleTapWhileDisabled = useCallback(() => {
    lastFocusedInputHandle?.current?.blur();
    navigate(Routes.EXPLAIN_SHEET, {
      inputToken: inputCurrency?.symbol,
      network: currentNetwork,
      onClose: () => {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            lastFocusedInputHandle?.current?.focus();
          }, 250);
        });
      },
      outputToken: outputCurrency?.symbol,
      type: 'output_disabled',
    });
  }, [
    currentNetwork,
    inputCurrency?.symbol,
    lastFocusedInputHandle,
    navigate,
    outputCurrency?.symbol,
  ]);

  const showConfirmButton = isSavings
    ? !!inputCurrency
    : !!inputCurrency && !!outputCurrency;

  return (
    <Wrapper keyboardType={KeyboardType.numpad}>
      <InnerWrapper
        isSmallPhone={isSmallPhone || (android && isSmallAndroidPhone)}
      >
        <FloatingPanels>
          <>
            <FloatingPanel
              borderRadius={39}
              overflow="visible"
              paddingBottom={{ custom: showOutputField ? 0 : 24 }}
              style={{
                ...(android && {
                  left: -1,
                }),
              }}
              testID={testID}
            >
              {showOutputField && <ExchangeNotch testID={testID} />}
              <ExchangeHeader testID={testID} title={title} />
              <ExchangeInputField
                disableInputCurrencySelection={isWithdrawal}
                editable={!!inputCurrency}
                inputAmount={inputAmountDisplay}
                inputCurrencyAddress={inputCurrency?.address}
                inputCurrencyAssetType={inputCurrency?.type}
                inputCurrencyMainnetAddress={inputCurrency?.mainnet_address}
                inputCurrencySymbol={inputCurrency?.symbol}
                inputFieldRef={inputFieldRef}
                loading={loading}
                nativeAmount={nativeAmountDisplay}
                nativeCurrency={nativeCurrency}
                nativeFieldRef={nativeFieldRef}
                network={currentNetwork}
                onFocus={handleFocus}
                onPressMaxBalance={handlePressMaxBalance}
                onPressSelectInputCurrency={navigateToSelectInputCurrency}
                setInputAmount={updateInputAmount}
                setNativeAmount={updateNativeAmount}
                testID={`${testID}-input`}
                updateAmountOnFocus={maxInputUpdate || flipCurrenciesUpdate}
              />
              {showOutputField && (
                <ExchangeOutputField
                  editable={
                    !!outputCurrency && currentNetwork !== Network.arbitrum
                  }
                  network={currentNetwork}
                  onFocus={handleFocus}
                  onPressSelectOutputCurrency={() =>
                    navigateToSelectOutputCurrency(chainId)
                  }
                  {...(currentNetwork === Network.arbitrum &&
                    !!outputCurrency && {
                      onTapWhileDisabled: handleTapWhileDisabled,
                    })}
                  loading={loading}
                  outputAmount={outputAmountDisplay}
                  outputCurrencyAddress={outputCurrency?.address}
                  outputCurrencyAssetType={outputCurrency?.type}
                  outputCurrencyMainnetAddress={outputCurrency?.mainnet_address}
                  outputCurrencySymbol={outputCurrency?.symbol}
                  outputFieldRef={outputFieldRef}
                  setOutputAmount={updateOutputAmount}
                  testID={`${testID}-output`}
                  updateAmountOnFocus={maxInputUpdate || flipCurrenciesUpdate}
                />
              )}
            </FloatingPanel>
            {isDeposit && (
              <DepositInfo
                amount={(Number(inputAmount) > 0 && outputAmount) || null}
                asset={outputCurrency}
                isHighPriceImpact={debouncedIsHighPriceImpact}
                onPress={navigateToSwapDetailsModal}
                priceImpactColor={priceImpactColor}
                priceImpactNativeAmount={priceImpactNativeAmount}
                priceImpactPercentDisplay={priceImpactPercentDisplay}
                testID="deposit-info-button"
              />
            )}
            {!isSavings && showConfirmButton && (
              <ExchangeDetailsRow
                isHighPriceImpact={
                  !confirmButtonProps.disabled &&
                  !confirmButtonProps.loading &&
                  debouncedIsHighPriceImpact &&
                  isSufficientBalance
                }
                onFlipCurrencies={loading ? NOOP : flipCurrencies}
                onPressImpactWarning={navigateToSwapDetailsModal}
                onPressSettings={navigateToSwapSettingsSheet}
                priceImpactColor={priceImpactColor}
                priceImpactNativeAmount={priceImpactNativeAmount}
                priceImpactPercentDisplay={priceImpactPercentDisplay}
                type={type}
              />
            )}

            {isWithdrawal && <Box height="30px" />}
          </>
        </FloatingPanels>
        <Box>
          <Rows alignVertical="bottom" space="19px">
            <Row height="content">
              {showConfirmButton && (
                <ConfirmExchangeButton
                  {...confirmButtonProps}
                  onPressViewDetails={
                    loading ? NOOP : navigateToSwapDetailsModal
                  }
                  testID={`${testID}-confirm-button`}
                />
              )}
            </Row>
            <Row height="content">
              <GasSpeedButton
                asset={outputCurrency}
                currentNetwork={currentNetwork}
                dontBlur
                flashbotTransaction={flashbots}
                marginBottom={0}
                marginTop={0}
                onCustomGasBlur={handleCustomGasBlur}
                testID={`${testID}-gas`}
              />
            </Row>
          </Rows>
        </Box>
      </InnerWrapper>
    </Wrapper>
  );
}