import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class PieceDownloader {
    private torrent: any;
    private downloadPath: string;

    constructor(torrent: any) {
        this.torrent = torrent;
        this.downloadPath = path.resolve(__dirname, './../../public/downloads', this.torrent.name);
        
        // Ensure download directory exists
        if (!fs.existsSync(this.downloadPath)) {
            fs.mkdirSync(this.downloadPath, { recursive: true });
        }
    }

    // Save individual piece with error handling
    savePiece(pieceIndex: number, data: Buffer): boolean {
        try {
            // Optional: Verify piece hash before saving
            if (this.verifyPieceHash(pieceIndex, data)) {
                const piecePath = path.join(this.downloadPath, `piece_${pieceIndex}.bin`);
                fs.writeFileSync(piecePath, data);
                console.log(`Saved piece ${pieceIndex}`);
                return true;
            } else {
                console.warn(`Piece ${pieceIndex} hash verification failed`);
                return false;
            }
        } catch (error) {
            console.error(`Error saving piece ${pieceIndex}:`, error);
            return false;
        }
    }

    // Optional hash verification
    private verifyPieceHash(pieceIndex: number, data: Buffer): boolean {
        const startIndex = pieceIndex * 20;
        const expectedHash = this.torrent.pieces.slice(startIndex, startIndex + 20);
        
        const calculatedHash = crypto
            .createHash('sha1')
            .update(data)
            .digest();
        
        return calculatedHash.equals(expectedHash);
    }

    // List downloaded pieces
    listDownloadedPieces(): string[] {
        return fs.readdirSync(this.downloadPath)
            .filter(file => file.startsWith('piece_') && file.endsWith('.bin'));
    }

    // Get total expected pieces
    getTotalPieces(): number {
        return Math.ceil(this.torrent.length / this.torrent.pieceLength);
    }
}