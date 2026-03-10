/* Wasm doesn't use the traditional _start trampoline.
   The host calls _start which is the Wasm export. */
#define START "_start"

static void _start_c(long *p) {
    /* In Wasm, we don't get argc/argv on the stack.
       Pass a minimal valid argv so __init_libc can safely do argv[0]. */
    static char *empty_argv[] = { "", NULL };
    __libc_start_main(main, 0, empty_argv, _init, _fini, 0);
}
