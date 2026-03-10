/* compiler_rt.c — Soft-float builtins for wasm32 fp128 (long double).
 *
 * Wasm32 clang uses 128-bit IEEE quad precision for long double, but
 * there's no hardware support. We provide minimal implementations
 * using raw bit manipulation to avoid recursive compiler-rt calls
 * (e.g. (double)fp128_val would call __trunctfdf2, causing infinite recursion).
 *
 * IEEE 754 quad precision (128-bit, little-endian):
 *   bits [0..111]   = fraction (112 bits)
 *   bits [112..126]  = exponent (15 bits, bias 16383)
 *   bit  [127]       = sign
 *
 * IEEE 754 double (64-bit, little-endian):
 *   bits [0..51]    = fraction (52 bits)
 *   bits [52..62]   = exponent (11 bits, bias 1023)
 *   bit  [63]       = sign
 *
 * IEEE 754 float (32-bit):
 *   bits [0..22]    = fraction (23 bits)
 *   bits [23..30]   = exponent (8 bits, bias 127)
 *   bit  [31]       = sign
 */

#include <stdint.h>
#include <string.h>

typedef long double fp128;

/* Raw bit representation of fp128 as two 64-bit words (little-endian). */
typedef union {
    fp128 f;
    uint64_t u[2];
} fp128_bits;

/* Raw bit representation of double. */
typedef union {
    double f;
    uint64_t u;
} f64_bits;

/* Raw bit representation of float. */
typedef union {
    float f;
    uint32_t u;
} f32_bits;

/* ===== fp128 → double conversion (no compiler-rt calls) ===== */

static double fp128_to_f64(fp128 a) {
    fp128_bits in;
    memcpy(&in, &a, sizeof(in));

    /* Extract fp128 fields */
    uint64_t lo = in.u[0];  /* fraction bits [0..63] */
    uint64_t hi = in.u[1];  /* fraction bits [64..111], exp [112..126], sign [127] */

    uint32_t sign = (hi >> 63) & 1;
    uint32_t exp128 = (hi >> 48) & 0x7FFF;
    /* Fraction: top 48 bits in hi[47:0], bottom 64 bits in lo */

    f64_bits out;

    if (exp128 == 0x7FFF) {
        /* Inf or NaN */
        uint64_t frac_hi = hi & 0x0000FFFFFFFFFFFFULL;
        if (frac_hi == 0 && lo == 0) {
            /* Infinity */
            out.u = ((uint64_t)sign << 63) | 0x7FF0000000000000ULL;
        } else {
            /* NaN - preserve some fraction bits */
            out.u = ((uint64_t)sign << 63) | 0x7FF8000000000000ULL | 1;
        }
        return out.f;
    }

    if (exp128 == 0) {
        /* Zero or subnormal → flush to zero for simplicity */
        out.u = (uint64_t)sign << 63;
        return out.f;
    }

    /* Normal number: convert exponent */
    int32_t unbiased = (int32_t)exp128 - 16383;

    if (unbiased > 1023) {
        /* Overflow → infinity */
        out.u = ((uint64_t)sign << 63) | 0x7FF0000000000000ULL;
        return out.f;
    }

    if (unbiased < -1074) {
        /* Underflow → zero */
        out.u = (uint64_t)sign << 63;
        return out.f;
    }

    /* Extract top 52 bits of the 112-bit fraction.
     * fp128 fraction: hi[47:0] are bits [111:64], lo is bits [63:0].
     * We want the top 52 bits = hi[47:0] (48 bits) + lo[63:60] (4 bits). */
    uint64_t frac52 = ((hi & 0x0000FFFFFFFFFFFFULL) << 4) | (lo >> 60);

    if (unbiased < -1022) {
        /* Subnormal double: shift fraction right */
        int shift = -1022 - unbiased;
        /* Add implicit 1 bit */
        frac52 = (1ULL << 52) | frac52;
        if (shift < 64) {
            frac52 >>= shift;
        } else {
            frac52 = 0;
        }
        out.u = ((uint64_t)sign << 63) | frac52;
        return out.f;
    }

    uint64_t exp64 = (uint64_t)(unbiased + 1023) & 0x7FF;
    out.u = ((uint64_t)sign << 63) | (exp64 << 52) | (frac52 & 0x000FFFFFFFFFFFFFULL);
    return out.f;
}

/* ===== double → fp128 conversion ===== */

static fp128 f64_to_fp128(double a) {
    f64_bits in;
    in.f = a;

    uint32_t sign = (in.u >> 63) & 1;
    uint32_t exp64 = (in.u >> 52) & 0x7FF;
    uint64_t frac52 = in.u & 0x000FFFFFFFFFFFFFULL;

    fp128_bits out;

    if (exp64 == 0x7FF) {
        /* Inf or NaN */
        out.u[1] = ((uint64_t)sign << 63) | (0x7FFFULL << 48);
        if (frac52 != 0) {
            out.u[1] |= 0x0000800000000000ULL; /* quiet NaN */
            out.u[0] = 1;
        } else {
            out.u[0] = 0;
        }
        fp128 result;
        memcpy(&result, &out, sizeof(result));
        return result;
    }

    if (exp64 == 0 && frac52 == 0) {
        /* Zero */
        out.u[1] = (uint64_t)sign << 63;
        out.u[0] = 0;
        fp128 result;
        memcpy(&result, &out, sizeof(result));
        return result;
    }

    int32_t unbiased;
    if (exp64 == 0) {
        /* Subnormal double → normalize */
        unbiased = -1022;
        while (!(frac52 & (1ULL << 52))) {
            frac52 <<= 1;
            unbiased--;
        }
        frac52 &= 0x000FFFFFFFFFFFFFULL; /* remove implicit 1 */
    } else {
        unbiased = (int32_t)exp64 - 1023;
    }

    uint64_t exp128 = (uint64_t)(unbiased + 16383) & 0x7FFF;

    /* Place 52-bit fraction into 112-bit field.
     * Top 48 bits of fraction → hi[47:0], remaining 4 bits → lo[63:60] */
    uint64_t frac_hi = frac52 >> 4;
    uint64_t frac_lo = (frac52 & 0xF) << 60;

    out.u[1] = ((uint64_t)sign << 63) | (exp128 << 48) | frac_hi;
    out.u[0] = frac_lo;

    fp128 result;
    memcpy(&result, &out, sizeof(result));
    return result;
}

/* ===== float → fp128 conversion ===== */

static fp128 f32_to_fp128(float a) {
    return f64_to_fp128((double)a);
}

/* ===== fp128 → float conversion ===== */

static float fp128_to_f32(fp128 a) {
    return (float)fp128_to_f64(a);
}

/* ===== Public API: Arithmetic ===== */

fp128 __addtf3(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    return f64_to_fp128(da + db);
}

fp128 __subtf3(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    return f64_to_fp128(da - db);
}

fp128 __multf3(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    return f64_to_fp128(da * db);
}

fp128 __divtf3(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    return f64_to_fp128(da / db);
}

/* ===== Public API: Conversions ===== */

fp128 __extendsftf2(float a) {
    return f32_to_fp128(a);
}

fp128 __extenddftf2(double a) {
    return f64_to_fp128(a);
}

float __trunctfsf2(fp128 a) {
    return fp128_to_f32(a);
}

double __trunctfdf2(fp128 a) {
    return fp128_to_f64(a);
}

int __fixtfsi(fp128 a) {
    return (int)fp128_to_f64(a);
}

long long __fixtfdi(fp128 a) {
    return (long long)fp128_to_f64(a);
}

unsigned int __fixunstfsi(fp128 a) {
    return (unsigned int)fp128_to_f64(a);
}

fp128 __floatsitf(int a) {
    return f64_to_fp128((double)a);
}

fp128 __floatunsitf(unsigned int a) {
    return f64_to_fp128((double)a);
}

/* ===== Public API: Comparisons ===== */

int __eqtf2(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    if (da == db) return 0;
    if (da < db) return -1;
    return 1;
}

int __netf2(fp128 a, fp128 b) {
    return __eqtf2(a, b);
}

int __letf2(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    if (da < db) return -1;
    if (da == db) return 0;
    return 1;
}

int __getf2(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    if (da > db) return 1;
    if (da == db) return 0;
    return -1;
}

int __lttf2(fp128 a, fp128 b) {
    return __letf2(a, b);
}

int __gttf2(fp128 a, fp128 b) {
    return __getf2(a, b);
}

int __unordtf2(fp128 a, fp128 b) {
    double da = fp128_to_f64(a);
    double db = fp128_to_f64(b);
    return (da != da) || (db != db);
}

/* ===== 128-bit integer multiply (needed by scanf/printf internals) ===== */

typedef struct { uint64_t lo; uint64_t hi; } u128;

typedef union {
    __int128 i;
    u128 parts;
} i128_bits;

__int128 __multi3(__int128 a, __int128 b) {
    i128_bits ua, ub;
    ua.i = a;
    ub.i = b;

    uint64_t a_lo = ua.parts.lo, a_hi = ua.parts.hi;
    uint64_t b_lo = ub.parts.lo, b_hi = ub.parts.hi;

    /* (a_hi * 2^64 + a_lo) * (b_hi * 2^64 + b_lo) mod 2^128
     * = a_lo*b_lo + (a_lo*b_hi + a_hi*b_lo) * 2^64 */
    uint64_t lo = a_lo * b_lo;

    /* High 64 bits of a_lo * b_lo */
    /* Use the widening multiply: split into 32-bit pieces */
    uint64_t a_lo_lo = a_lo & 0xFFFFFFFF;
    uint64_t a_lo_hi = a_lo >> 32;
    uint64_t b_lo_lo = b_lo & 0xFFFFFFFF;
    uint64_t b_lo_hi = b_lo >> 32;

    uint64_t cross1 = a_lo_lo * b_lo_hi;
    uint64_t cross2 = a_lo_hi * b_lo_lo;
    uint64_t lo_lo = a_lo_lo * b_lo_lo;
    uint64_t hi_hi = a_lo_hi * b_lo_hi;

    uint64_t carry = ((lo_lo >> 32) + (cross1 & 0xFFFFFFFF) + (cross2 & 0xFFFFFFFF)) >> 32;
    uint64_t hi = hi_hi + (cross1 >> 32) + (cross2 >> 32) + carry;

    hi += a_lo * b_hi + a_hi * b_lo;

    i128_bits result;
    result.parts.lo = lo;
    result.parts.hi = hi;
    return result.i;
}
