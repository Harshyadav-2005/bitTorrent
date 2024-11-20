import readline from 'readline';
import { parseTorrentFile } from '../core/torrent-parser';
import { downloadPiece } from '../core/peer-connection';
import { connectToTrackers } from '../core/tracker';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the path to your .torrent file: ', (filePath) => {
    const torrent = parseTorrentFile(filePath);
    console.log('Parsed Torrent Info:', torrent);

    connectToTrackers(torrent, (peers) => {
        if (peers.length > 0) {
            console.log(`Found ${peers.length} peers!`);
            
            // Try downloading from multiple peers
            function tryDownloadFromPeers(peerList: { ip: string; port: number }[]) {
                if (peerList.length === 0) {
                    console.log('Failed to download from all peers');
                    rl.close();
                    return;
                }

                const currentPeer = peerList[0];
                downloadPiece(currentPeer, 0, (data) => {
                    if (data) {
                        console.log('Downloaded piece:', data);
                        rl.close(); 
                    } else {
                        // Remove failed peer and try next
                        tryDownloadFromPeers(peerList.slice(1));
                    }
                });
            }

            tryDownloadFromPeers(peers);
        } else {
            console.log('No peers found.');
            rl.close();
        }
    });
});