import MerkleTools from '@settlemint/merkle-tools';
import Axios from 'axios';
import { JsonRpcProvider } from 'ethers/providers/json-rpc-provider';
import { sha3_512 } from 'js-sha3';
import { Readable } from 'stream';

export enum Protocol {
  BITCOIN = 'bitcoin',
  ETHEREUM = 'ethereum',
}

export enum NetworkName {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
}

export enum DataType {
  STRING = 'STRING',
  FILE = 'FILE',
  HASH = 'HASH',
}

export interface ISeal {
  id: string;
  dataHash: string;
  anchors: IAnchors<IAnchor>;
  signatures?: ISignatures;
  signinvites?: ISignInvites;
  sealed: string;
}

export interface IAnchor {
  transactionId: string;
  nodeUrl: string;
  explorer: string;
  merkleRoot: string;
  proof: IProof[];
  exists?: boolean;
}

export interface IInviteAnchor extends IAnchor {
  invites?: { [inviteId: string]: ISignInvite };
}

export interface ISignInvite {
  proof: IProof[];
  hash: string;
}

export interface IAnchors<Type> {
  ethereum?: {
    [networkId: string]: Type;
  };
  bitcoin?: {
    mainnet?: Type;
    testnet?: Type;
  };
}

export interface IProof {
  right?: string;
  left?: string;
}

export interface ISignatures {
  ethereum?: {
    [signerAddress: string]: {
      transactionId: string;
      nodeUrl: string;
      explorer: string;
      signature: string;
      signed: string;
    };
  };
}

export interface ISignInvites {
  anchors: IAnchors<IInviteAnchor>;
}

export class CertiMintValidation {
  public apiKey: string;

  constructor(apiKey: string = null) {
    this.apiKey = apiKey;
  }

  public async validateSealAndData(
    seal: ISeal,
    data: string,
    dataType: DataType,
    ethereumUrl?: string, //TODO: this should be removed since this is never used, but this will break legacy systems
    bitcoinUrl: string = 'https://api.blockcypher.com/v1/btc/main'
  ): Promise<boolean> {
    const hash = await this.hashForData(data, dataType);
    return (
      hash === seal.dataHash && this.validateSeal(seal, ethereumUrl, bitcoinUrl)
    );
  }

  public async validateSeal(
    seal: ISeal,
    ethereumUrl?: string, //TODO: this should be removed since this is never used, but this will break legacy systems
    bitcoinUrl: string = 'https://api.blockcypher.com/v1/btc/main'
  ): Promise<boolean> {
    const validAnchors = await this.validateAnchors(
      seal.anchors,
      seal.dataHash,
      bitcoinUrl
    );

    const validSignatures = await this.validateSignatures(seal.signatures);
    const validSignInvites = await this.validateSignInvites(seal.signinvites);

    return validAnchors && validSignatures && validSignInvites;
  }

  private async hashForData(
    data: string | Readable | Blob,
    dataType: DataType
  ) {
    let hex: string;
    switch (dataType) {
      case DataType.FILE:
        if (data instanceof Readable) {
          hex = await this.streamToHashForNode(data);
        } else if (data instanceof Blob) {
          hex = await this.streamToHashForBrowser(data);
        }
        break;
      case DataType.STRING:
        if (data instanceof Readable || data instanceof Blob) {
          throw new Error(
            `ERROR: Data cannot be Readable or Blob for ${dataType}`
          );
        }
        hex = sha3_512(data);
        break;
      case DataType.HASH:
        if (data instanceof Readable || data instanceof Blob) {
          throw new Error(
            `ERROR: Data cannot be Readable or Blob for ${dataType}`
          );
        }
        hex = data;
        break;
      default:
        throw new Error(`ERROR: unknown type ${dataType}`);
    }
    return hex;
  }

  private async validateAnchors(
    anchors: IAnchors<IAnchor>,
    dataHash: string,
    bitcoinUrl: string
  ): Promise<boolean> {
    let isValid = true;
    for (const protocol of Object.keys(anchors)) {
      switch (protocol) {
        case Protocol.ETHEREUM:
          isValid =
            isValid &&
            (await this.validateEthereumAnchor(anchors, dataHash, isValid));
          break;
        case Protocol.BITCOIN:
          isValid =
            isValid &&
            (await this.validateBitcoinAnchor(
              anchors,
              dataHash,
              bitcoinUrl,
              isValid
            ));
          break;
      }
    }

    return isValid;
  }

  private async validateEthereumAnchor(
    anchors: IAnchors<IAnchor>,
    dataHash: string,
    isValid: boolean
  ) {
    for (const chainId of Object.keys(anchors[Protocol.ETHEREUM])) {
      const anchor = anchors[Protocol.ETHEREUM][chainId];
      const provider = new JsonRpcProvider(anchor.nodeUrl);

      const tx = await provider.getTransaction(
        this.addHexPrefix(anchor.transactionId)
      );

      anchor.exists = tx.data === this.addHexPrefix(anchor.merkleRoot);

      const merkleTools = new MerkleTools({
        hashType: 'SHA3-512',
      });

      const validProof = merkleTools.validateProof(
        anchor.proof,
        dataHash,
        anchor.merkleRoot
      );

      return isValid && anchor.exists && validProof;
    }
  }

  private async validateBitcoinAnchor(
    anchors: IAnchors<IAnchor>,
    dataHash: string,
    baseUrl: string,
    isValid: boolean
  ) {
    for (const networkName of Object.keys(anchors[Protocol.BITCOIN])) {
      const anchor = anchors[Protocol.BITCOIN][networkName];
      try {
        const txId = anchor.transactionId;
        const tx = await Axios.get(this.buildTxUrl(baseUrl, txId));

        const txOutputs = tx.data.outputs;
        let merkleRoot: string;
        for (const output of txOutputs) {
          if (output.data_hex !== undefined && output.data_hex != null) {
            merkleRoot = output.data_hex;
          }
        }

        anchor.exists = merkleRoot === anchor.merkleRoot;

        const merkleTools = new MerkleTools({
          hashType: 'SHA3-512',
        });

        const validProof = merkleTools.validateProof(
          anchor.proof,
          dataHash,
          anchor.merkleRoot
        );

        return isValid && anchor.exists && validProof;
      } catch (error) {
        if (error.response !== undefined && error.response.status === 429) {
          throw new Error(
            'Too many request to the blockcypher api, please add an apikey or upgrade your blockcypher plan'
          );
        } else {
          throw error;
        }
      }
    }
  }

  private async validateSignatures(signatures: ISignatures): Promise<boolean> {
    let isValid = true;
    for (const protocol of Object.keys(signatures)) {
      for (const address of Object.keys(signatures[protocol])) {
        //This should technically not be neccessary since we only anchor signatures on Ethereum
        if (protocol === Protocol.ETHEREUM) {
          const signature = signatures[protocol][address];
          const signatureProvider = new JsonRpcProvider(signature.nodeUrl);
          const tx = await signatureProvider.getTransaction(
            this.addHexPrefix(signature.transactionId)
          );
          isValid =
            isValid && tx.data === this.addHexPrefix(signature.signature);
        }
      }
    }

    return isValid;
  }

  private async validateSignInvites(
    signInvites: ISignInvites
  ): Promise<boolean> {
    if (signInvites && signInvites.anchors) {
      const signInviteAnchors = signInvites.anchors;
      let isValid = true;
      for (const protocol of Object.keys(signInviteAnchors)) {
        for (const chainId of Object.keys(signInviteAnchors[protocol])) {
          //This should technically not be neccessary since we only anchor signinvites on Ethereum
          if (protocol === Protocol.ETHEREUM) {
            const signInvite = signInviteAnchors[protocol][chainId];
            const signInviteProvider = new JsonRpcProvider(signInvite.nodeUrl);
            const tx = await signInviteProvider.getTransaction(
              this.addHexPrefix(signInvite.transactionId)
            );

            signInvite.exists =
              tx.data === this.addHexPrefix(signInvite.merkleRoot);

            const merkleTools = new MerkleTools({
              hashType: 'SHA3-512',
            });
            let validProof = true;

            for (const inviteId of Object.keys(signInvite.invites)) {
              const inviteAnchor = signInvite.invites[inviteId];

              validProof = merkleTools.validateProof(
                inviteAnchor.proof,
                inviteAnchor.hash,
                signInvite.merkleRoot
              );
            }

            isValid = isValid && validProof && signInvite.exists;
          }
        }
      }

      return isValid;
    }
    return true;
  }

  private addHexPrefix(fromValue: string) {
    return this.isHexPrefixed(fromValue) ? fromValue : '0x' + fromValue;
  }

  private isHexPrefixed(valueToCheck: string) {
    return (
      typeof valueToCheck === 'string' && valueToCheck.substring(0, 2) === '0x'
    );
  }

  private streamToHashForNode(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const allData: Buffer[] = [];
      stream.on('data', chunk => {
        allData.push(chunk);
      });
      stream.on('end', () => {
        resolve(sha3_512(Buffer.concat(allData)));
      });
      stream.on('error', error => {
        reject(error);
      });
    });
  }

  private streamToHashForBrowser(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(sha3_512(reader.result as ArrayBuffer));
      };
      reader.onerror = () => {
        reject('Could not read file');
      };
      reader.readAsArrayBuffer(file);
    });
  }

  private buildTxUrl(baseUrl: string, txId: string) {
    const apiKey = this.apiKey !== null ? `?token=${this.apiKey}` : '';
    return `${baseUrl}/txs/${txId}${apiKey}`;
  }
}
