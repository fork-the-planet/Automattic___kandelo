/*
 * syscall_arch.h — wasm32posix syscall ABI definitions.
 *
 * On this architecture, __syscallN functions are implemented in
 * glue/syscall_glue.c as real functions (not inline assembly).
 * They dispatch on the syscall number and call typed kernel_* imports.
 */

/*
 * Split a 64-bit value into two 32-bit syscall arguments.
 * E = even-aligned position, O = odd-aligned position.
 * On wasm32 there are no register-pair alignment constraints,
 * so both are identical.
 */
#define __SYSCALL_LL_E(x) \
    ((union { long long ll; long l[2]; }){ .ll = (x) }).l[0], \
    ((union { long long ll; long l[2]; }){ .ll = (x) }).l[1]
#define __SYSCALL_LL_O(x) __SYSCALL_LL_E(x)

/*
 * Declare the dispatch functions.  musl's src/internal/syscall.h will
 * layer __scc()-wrapping macros on top of these declarations.
 */
long __syscall0(long);
long __syscall1(long, long);
long __syscall2(long, long, long);
long __syscall3(long, long, long, long);
long __syscall4(long, long, long, long, long);
long __syscall5(long, long, long, long, long, long);
long __syscall6(long, long, long, long, long, long, long);
