class WoundsCalculator extends FormApplication {
    constructor(damage, ap, reroll = false) {
        super();
        this.damage = damage;
        this.ap = ap;
        this.reroll = reroll;
    }
}