/*
 * fork() for wasm32posix — simplified version for single-threaded Wasm.
 *
 * Skips atfork lock handling since Wasm instances are single-threaded.
 * Delegates to _Fork() which calls __syscall(SYS_fork) → kernel_fork().
 */

#include <unistd.h>

pid_t _Fork(void);

pid_t fork(void)
{
	return _Fork();
}
