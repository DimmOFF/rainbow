import { Buffer } from 'buffer';
import { Contract } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { AvatarRequestOpts } from '..';
import { resolveURI } from '../utils';
import { UniqueAsset } from '@rainbow-me/entities';
import { apiGetAccountUniqueToken } from '@rainbow-me/handlers/opensea-api';
import { getNFTByTokenId } from '@rainbow-me/handlers/simplehash';
import svgToPngIfNeeded from '@rainbow-me/handlers/svgs';
import { NetworkTypes } from '@rainbow-me/helpers';

const abi = [
  'function tokenURI(uint256 tokenId) external view returns (string memory)',
  'function ownerOf(uint256 tokenId) public view returns (address)',
];

export default class ERC721 {
  async getMetadata(
    provider: BaseProvider,
    ownerAddress: string | undefined,
    contractAddress: string,
    tokenID: string,
    opts?: AvatarRequestOpts
  ) {
    const contract = new Contract(contractAddress, abi, provider);
    const [tokenURI, owner] = await Promise.all([
      contract.tokenURI(tokenID),
      ownerAddress && contract.ownerOf(tokenID),
    ]);
    if (
      !opts?.allowNonOwnerNFTs &&
      ownerAddress &&
      owner.toLowerCase() !== ownerAddress.toLowerCase()
    ) {
      return null;
    }

    let image;

    const { uri: resolvedURI, isOnChain, isEncoded } = resolveURI(tokenURI);
    let _resolvedUri = resolvedURI;
    if (isOnChain) {
      if (isEncoded) {
        _resolvedUri = Buffer.from(
          resolvedURI.replace('data:application/json;base64,', ''),
          'base64'
        ).toString();
      }
      const data = JSON.parse(_resolvedUri);
      image = svgToPngIfNeeded(data?.image, false);
    }

    try {
      const data: UniqueAsset = await apiGetAccountUniqueToken(
        NetworkTypes.mainnet,
        contractAddress,
        tokenID
      );
      image = svgToPngIfNeeded(data?.image_url, false) || data?.lowResUrl;
    } catch (error) {
      const data = await getNFTByTokenId({ contractAddress, tokenId: tokenID });
      image = svgToPngIfNeeded(data?.previews?.image_medium_url, false);
      if (!image) throw new Error('no image found');
    }
    return { image };
  }
}
