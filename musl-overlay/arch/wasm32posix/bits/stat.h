/* bits/stat.h — wasm32posix struct stat
 *
 * Must match the kernel's WasmStat layout (88 bytes, repr(C)).
 * See crates/shared/src/lib.rs.
 *
 * On wasm32 little-endian, struct timespec is:
 *   { time_t tv_sec; long tv_nsec; int :32; }  =  16 bytes
 * which exactly matches each (u64 sec, u32 nsec, 4-byte pad) group
 * in WasmStat.  The trailing _pad field in WasmStat falls inside
 * the bitfield padding of st_ctim's timespec.
 */

struct stat {
	unsigned long long st_dev;          /* offset  0 */
	unsigned long long st_ino;          /* offset  8 */
	unsigned int       st_mode;         /* offset 16 */
	unsigned int       st_nlink;        /* offset 20 */
	unsigned int       st_uid;          /* offset 24 */
	unsigned int       st_gid;          /* offset 28 */
	unsigned long long st_size;         /* offset 32 */
	struct timespec    st_atim;         /* offset 40  (16 bytes) */
	struct timespec    st_mtim;         /* offset 56  (16 bytes) */
	struct timespec    st_ctim;         /* offset 72  (16 bytes) */
};

/* Total size must match kernel WasmStat */
_Static_assert(sizeof(struct stat) == 88,
	"struct stat size mismatch with kernel WasmStat");

/* Key field offsets must match kernel layout */
_Static_assert(__builtin_offsetof(struct stat, st_size) == 32,
	"st_size offset mismatch");
_Static_assert(__builtin_offsetof(struct stat, st_atim) == 40,
	"st_atim offset mismatch");
_Static_assert(__builtin_offsetof(struct stat, st_mtim) == 56,
	"st_mtim offset mismatch");
_Static_assert(__builtin_offsetof(struct stat, st_ctim) == 72,
	"st_ctim offset mismatch");
