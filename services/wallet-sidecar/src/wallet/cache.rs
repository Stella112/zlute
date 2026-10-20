//! In-memory compact block cache for `zcash_client_backend::sync::run`.
//!
//! Modeled on the `BlockCache` doc example in `zcash_client_backend@0.24.0`
//! `src/data_api/chain.rs`. Blocks are only held between download and scan; nothing is persisted.

use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use zcash_client_backend::{
    data_api::{
        chain::{error, BlockCache, BlockSource},
        scanning::ScanRange,
    },
    proto::compact_formats::CompactBlock,
};
use zcash_protocol::consensus::BlockHeight;

#[derive(Debug)]
pub struct CacheError(pub String);

impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "block cache: {}", self.0)
    }
}

impl std::error::Error for CacheError {}

#[derive(Default)]
pub struct MemBlockCache {
    blocks: Mutex<BTreeMap<u32, CompactBlock>>,
}

fn height_of(block: &CompactBlock) -> u32 {
    u32::try_from(block.height).expect("block heights fit in u32")
}

impl MemBlockCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<u32, CompactBlock>> {
        // A poisoned lock means a panic mid-update; the cache is disposable, so recover it.
        self.blocks.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl BlockSource for MemBlockCache {
    type Error = CacheError;

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), error::Error<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), error::Error<WalletErrT, Self::Error>>,
    {
        let start = from_height.map(u32::from).unwrap_or(0);
        let blocks: Vec<CompactBlock> = self
            .lock()
            .range(start..)
            .take(limit.unwrap_or(usize::MAX))
            .map(|(_, b)| b.clone())
            .collect();
        for block in blocks {
            with_block(block)?;
        }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemBlockCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, CacheError> {
        let blocks = self.lock();
        let tip = match range {
            Some(r) => blocks
                .range(u32::from(r.block_range().start)..u32::from(r.block_range().end))
                .next_back()
                .map(|(h, _)| *h),
            None => blocks.keys().next_back().copied(),
        };
        Ok(tip.map(BlockHeight::from_u32))
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, CacheError> {
        Ok(self
            .lock()
            .range(u32::from(range.block_range().start)..u32::from(range.block_range().end))
            .map(|(_, b)| b.clone())
            .collect())
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), CacheError> {
        let mut blocks = self.lock();
        for b in compact_blocks {
            blocks.insert(height_of(&b), b);
        }
        Ok(())
    }

    async fn delete(&self, range: ScanRange) -> Result<(), CacheError> {
        let (start, end) = (
            u32::from(range.block_range().start),
            u32::from(range.block_range().end),
        );
        self.lock().retain(|h, _| !(start..end).contains(h));
        Ok(())
    }
}
