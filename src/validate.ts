import MerkleTools from '@settlemint/merkle-tools';
import Axios from 'axios';
import { JsonRpcProvider } from 'ethers/providers/json-rpc-provider';
import { sha3_512 } from 'js-sha3';
import { Readable } from 'stream';

export enum Protocol {
  BITCOIN = 'BITCOIN',
  ETHEREUM = 'ETHEREUM'
}

export enum NetworkName {
  testnet = 'testnet',
  mainnet = 'mainnet'
}

export enum DataType {
  STRING = 'STRING',
  FILE = 'FILE',
  HASH = 'HASH'
}

export interface ISeal {
  id: string;
  dataHash: string;
  anchors: IAnchors;
  signatures?: ISignatures;
  signinvites?: ISignInvites;
  sealed: string;
}

export interface IAnchors {
  ethereum?: {
    [networkId: string]: {
      transactionId: string;
      nodeUrl: string;
      explorer: string;
      merkleRoot: string;
      proof: IProof[];
    };
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
      explorer: string;
      signature: string;
      signed: string;
    };
  };
}

export interface ISignInvites {
  anchors: IAnchors;
}

export class CertiMintValidation {
  public protocol: string;
  public apiKey: string;

  constructor(protocol: Protocol = Protocol.ETHEREUM, apiKey: string = null) {
    this.protocol = protocol;
    this.apiKey = apiKey;
  }

  public async validateSealAndData(
    seal: ISeal,
    data: string,
    dataType: DataType,
    baseUrl: string = 'https://mainnet.infura.io'
  ): Promise<boolean> {
    const hash = await this.hashForData(data, dataType);
    return hash === seal.dataHash && this.validateSeal(seal, baseUrl);
  }

  public async validateSeal(
    seal: ISeal,
    baseUrl: string = 'https://mainnet.infura.io'
  ): Promise<boolean> {
    const validAnchors = await this.validateAnchors(
      seal.anchors,
      seal.dataHash,
      baseUrl
    );

    let validSignatures = true;
    if (this.protocol === Protocol.ETHEREUM) {
      validSignatures = await this.validateSignatures(seal.signatures, baseUrl);
    }
    return validAnchors && validSignatures;
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
    anchors: any,
    dataHash: string,
    baseUrl: string
  ): Promise<boolean> {
    let isValid = false;
    for (const protocol of Object.keys(anchors)) {
      if (this.protocol === Protocol.ETHEREUM) {
        for (const chainId of Object.keys(anchors[protocol])) {
          const anchor = anchors[protocol][chainId];
          const provider = new JsonRpcProvider(anchor.nodeUrl);

          const tx = await provider.getTransaction(
            this.addHexPrefix(anchor.transactionId)
          );

          anchor.exists = tx.data === this.addHexPrefix(anchor.merkleRoot);

          const merkleTools = new MerkleTools({
            hashType: 'SHA3-512'
          });

          const validProof = merkleTools.validateProof(
            anchor.proof,
            dataHash,
            anchor.merkleRoot
          );

          isValid = anchor.exists && validProof;
        }
      } else {
        for (const networkName of Object.keys(anchors[protocol])) {
          const anchor = anchors[protocol][networkName];
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
              hashType: 'SHA3-512'
            });

            const validProof = merkleTools.validateProof(
              anchor.proof,
              dataHash,
              anchor.merkleRoot
            );

            isValid = anchor.exists && validProof;
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
    }

    return isValid;
  }

  private async validateSignatures(
    signatures: any,
    baseUrl: string
  ): Promise<boolean> {
    const signatureProvider = new JsonRpcProvider(baseUrl);
    let isValid = true;
    for (const protocol of Object.keys(signatures)) {
      for (const address of Object.keys(signatures[protocol])) {
        const signature = signatures[protocol][address];
        const tx = await signatureProvider.getTransaction(
          this.addHexPrefix(signature.transactionId)
        );
        signature.isValid = tx.data === this.addHexPrefix(signature.signature);
        isValid = isValid && signature.isValid;
      }
    }

    return isValid;
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
