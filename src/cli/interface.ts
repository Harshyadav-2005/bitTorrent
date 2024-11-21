import readline from 'readline';
import { parseTorrentFile } from '../core/torrent-parser';
import { downloadPiece } from '../core/peer-connection';
import { connectToTrackers } from '../core/tracker';
import { PieceDownloader } from '../core/piece-downloader';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the path to your .torrent file: ', (filePath) => {
    try {
        const torrent = parseTorrentFile(filePath);
        console.log('Parsed Torrent Info:', torrent);

        // Create piece downloader
        const pieceDownloader = new PieceDownloader(torrent);
        const totalPieces = pieceDownloader.getTotalPieces();

        connectToTrackers(torrent, (peers) => {
            if (peers.length > 0) {
                console.log(`Found ${peers.length} peers! Starting download...`);
                
                // Download strategy with multiple piece attempts
                function downloadPieceWithRetry(
                    pieceIndex: number, 
                    peerList: { ip: string; port: number }[], 
                    maxAttempts: number = 5
                ) {
                    if (peerList.length === 0 || maxAttempts <= 0) {
                        console.log(`Waiting for Response to download piece ${pieceIndex} from all peers`);
                        
                        // If all pieces downloaded, close
                        if (pieceIndex === totalPieces - 1) {
                            console.log('Download complete!');
                        rl.close();
                        }
                        return;
                    }

                    const currentPeer = peerList[0];
                    console.log(`Attempting to download piece ${pieceIndex} from ${currentPeer.ip}:${currentPeer.port}`);

                    downloadPiece(currentPeer, pieceIndex, (data) => {
                        if (data) {
                            // Attempt to save piece
                            if (pieceDownloader.savePiece(pieceIndex, data)) {
                                console.log(`Successfully downloaded piece ${pieceIndex}`);
                                
                                // Proceed to next piece or close if complete
                                if (pieceIndex < totalPieces - 1) {
                                    downloadPieceWithRetry(pieceIndex + 1, peers);
                                } else {
                                    console.log('Download complete!');
                            rl.close(); 
                                }
                            } else {
                                // Retry with next peer if piece save fails
                                downloadPieceWithRetry(
                                    pieceIndex, 
                                    peerList.slice(1), 
                                    maxAttempts - 1
                                );
                            }
                        } else {
                            // Try next peer
                            downloadPieceWithRetry(
                                pieceIndex, 
                                peerList.slice(1), 
                                maxAttempts - 1
                            );
                        }
                    });
                }

                // Start downloading first piece
                downloadPieceWithRetry(0, peers);
            } else {
                console.log('No peers found.');
                rl.close();
            }
        });
    } catch (error) {
        console.error('Error processing torrent file:', error);
        rl.close();
    }
});