import { useCallback, useMemo } from 'react';
import { useQuery } from 'react-query';
import { useAccountSettings } from '.';
import { estimateENSRegistrationGasLimit } from '@rainbow-me/handlers/ens';
import {
  formatEstimatedNetworkFee,
  formatRentPrice,
  formatTotalRegistrationCost,
} from '@rainbow-me/helpers/ens';
import { Network } from '@rainbow-me/helpers/networkTypes';
import { add, addDisplay, multiply } from '@rainbow-me/helpers/utilities';
import { getEIP1559GasParams } from '@rainbow-me/redux/gas';
import { ethereumUtils } from '@rainbow-me/utils';

const secsInYear = 31536000;

export default function useENSRegistrationCosts({
  duration,
  name,
  rentPrice,
}: {
  duration: number;
  name: string;
  rentPrice?: { wei: number; perYear: { wei: number } };
}) {
  const { nativeCurrency, accountAddress } = useAccountSettings();

  const rentPriceInWei = rentPrice?.wei?.toString();

  const getEstimatedNetworkFee = useCallback(async () => {
    if (!rentPriceInWei) return;

    const nativeAssetPrice = ethereumUtils.getPriceOfNativeAssetForNetwork(
      Network.mainnet
    );
    const gasLimit = await estimateENSRegistrationGasLimit(
      name,
      accountAddress,
      duration * secsInYear,
      rentPriceInWei
    );

    const { gasFeeParamsBySpeed, currentBaseFee } = await getEIP1559GasParams();

    const formattedEstimatedNetworkFee = formatEstimatedNetworkFee(
      gasLimit,
      currentBaseFee.gwei,
      gasFeeParamsBySpeed.normal.maxPriorityFeePerGas.gwei,
      nativeCurrency,
      nativeAssetPrice
    );

    return formattedEstimatedNetworkFee;
  }, [accountAddress, duration, name, nativeCurrency, rentPriceInWei]);

  const { data: estimatedNetworkFee, status } = useQuery(
    Boolean(rentPriceInWei) && [
      'getEstimatedNetworkFee',
      [accountAddress, name, nativeCurrency, rentPriceInWei],
    ],
    getEstimatedNetworkFee,
    { cacheTime: 0 }
  );

  const data = useMemo(() => {
    const rentPricePerYearInWei = rentPrice?.perYear?.wei?.toString();
    if (estimatedNetworkFee && rentPricePerYearInWei) {
      const nativeAssetPrice = ethereumUtils.getPriceOfNativeAssetForNetwork(
        Network.mainnet
      );
      const rentPrice = multiply(rentPricePerYearInWei, duration);
      const estimatedRentPrice = formatRentPrice(
        rentPrice,
        duration,
        nativeCurrency,
        nativeAssetPrice
      );

      const weiEstimatedTotalCost = add(
        estimatedNetworkFee.wei,
        estimatedRentPrice.wei.toString()
      );
      const displayEstimatedTotalCost = addDisplay(
        estimatedNetworkFee.display,
        estimatedRentPrice.total.display
      );
      const estimatedTotalRegistrationCost = formatTotalRegistrationCost(
        weiEstimatedTotalCost,
        nativeCurrency,
        nativeAssetPrice
      );

      return {
        estimatedNetworkFee: estimatedNetworkFee,
        estimatedRentPrice,
        estimatedTotalRegistrationCost: {
          ...estimatedTotalRegistrationCost,
          display: displayEstimatedTotalCost,
        },
      };
    }
  }, [duration, estimatedNetworkFee, nativeCurrency, rentPrice?.perYear?.wei]);

  const newStatus = rentPrice ? status : 'idle';

  const isIdle = newStatus === 'idle';
  const isLoading = newStatus === 'loading';
  const isSuccess = newStatus === 'success' && !!data?.estimatedRentPrice;

  return {
    data,
    isIdle,
    isLoading,
    isSuccess,
  };
}